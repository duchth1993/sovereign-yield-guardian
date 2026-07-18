// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SovereignYield
 * @notice Reputation-driven yield vault for OPN Chain (Chain ID 984).
 *         Every deposit/withdrawal updates the caller's on-chain reputation
 *         (Nexus REP) and emits ReputationBoosted so front-ends can render
 *         real-time REP changes tied to NeoID.
 *
 *         This is a proof-of-concept vault: it accepts a stablecoin (USDC-like
 *         ERC20) and tracks principal per user. APY is computed off-chain from
 *         the REP tier (I..V => 5%..18%). No anonymous farming: any address
 *         that has never earned REP starts at tier I after their first deposit.
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SovereignYield {
    IERC20 public immutable stablecoin;

    mapping(address => uint256) public principal;   // deposited amount
    mapping(address => uint256) public reputation;  // on-chain REP score
    mapping(address => uint256) public lastAction;  // timestamp

    event Deposited(address indexed user, uint256 amount, uint256 newPrincipal);
    event Withdrawn(address indexed user, uint256 amount, uint256 newPrincipal);
    event ReputationBoosted(address indexed user, uint256 newREP);

    // REP gained per unit of activity. Tuned small so demo txs move the needle
    // without letting whales dominate.
    uint256 public constant REP_PER_DEPOSIT = 25;
    uint256 public constant REP_PER_WITHDRAW = 5;
    uint256 public constant REP_PER_1e6_UNITS = 1; // +1 REP per 1 USDC (6 decimals)

    constructor(address _stablecoin) {
        stablecoin = IERC20(_stablecoin);
    }

    /// @notice Deposit `amount` of the stablecoin. Must have approved this contract first.
    function deposit(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(stablecoin.transferFrom(msg.sender, address(this), amount), "transferFrom failed");

        principal[msg.sender] += amount;
        lastAction[msg.sender] = block.timestamp;

        uint256 gained = REP_PER_DEPOSIT + (amount / 1e6) * REP_PER_1e6_UNITS;
        reputation[msg.sender] += gained;

        emit Deposited(msg.sender, amount, principal[msg.sender]);
        emit ReputationBoosted(msg.sender, reputation[msg.sender]);
    }

    /// @notice Withdraw `amount` back to caller. REP still grows (activity counts).
    function withdraw(uint256 amount) external {
        require(amount > 0, "amount=0");
        require(principal[msg.sender] >= amount, "insufficient principal");

        principal[msg.sender] -= amount;
        lastAction[msg.sender] = block.timestamp;

        reputation[msg.sender] += REP_PER_WITHDRAW;

        require(stablecoin.transfer(msg.sender, amount), "transfer failed");

        emit Withdrawn(msg.sender, amount, principal[msg.sender]);
        emit ReputationBoosted(msg.sender, reputation[msg.sender]);
    }

    /// @notice Off-chain UIs read this to determine tier and APY.
    function getAccount(address user) external view returns (
        uint256 _principal,
        uint256 _reputation,
        uint256 _lastAction
    ) {
        return (principal[user], reputation[user], lastAction[user]);
    }
}
