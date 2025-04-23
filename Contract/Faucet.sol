// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol"; // Interface only needed
import "@openzeppelin/contracts/access/Ownable.sol";     // For ownership/control
import "@openzeppelin/contracts/security/ReentrancyGuard.sol"; // Good practice
import "@openzeppelin/contracts/utils/Pausable.sol";       // Optional: For pausing

/**
 * @title ClisFaucet
 * @dev A faucet contract that dispenses a fixed amount of a specific ERC20 token (CLIS)
 *      to users with a time lock between withdrawals.
 *      Requires CLIS tokens to be transferred *to* this contract address to function.
 */
contract ClisFaucet is Ownable, ReentrancyGuard, Pausable {

    // --- State Variables ---
    IERC20 public immutable token; // The CLIS token contract address (set once)

    uint256 public withdrawalAmount; // Amount of tokens to withdraw (configurable)
    uint256 public lockTime;         // Cooldown period in seconds (configurable)

    mapping(address => uint256) public nextAccessTime; // User's next allowed withdrawal time

    // --- Events ---
    event Withdrawal(address indexed to, uint256 amount); // Tokens withdrawn
    event ConfigUpdated(string setting, uint256 value); // Log config changes

    // --- Errors ---
    error FaucetInsufficientBalance();
    error TransferFailed();
    error LockTimeNotElapsed();
    error WithdrawalAmountNotSet();
    error WithdrawAmountMustBePositive();
    error LockTimeTooShort();


    // --- Constructor ---
    constructor(
        address initialOwner,
        address _tokenAddress,
        uint256 _initialWithdrawalAmount,
        uint256 _initialLockTime
    ) Ownable(initialOwner) {
        require(_tokenAddress != address(0), "Token address cannot be zero");
        token = IERC20(_tokenAddress); // Store the token contract interface

        // Ensure initial settings are valid
        if (_initialWithdrawalAmount == 0) revert WithdrawalAmountNotSet();
        withdrawalAmount = _initialWithdrawalAmount;
        emit ConfigUpdated("WithdrawalAmount", _initialWithdrawalAmount);

        if (_initialLockTime < 1 minutes) revert LockTimeTooShort(); // Set a minimum practical lock time
        lockTime = _initialLockTime;
        emit ConfigUpdated("LockTime", _initialLockTime);
    }

    // --- Functions ---

    /**
     * @dev Allows users to request CLIS tokens from the faucet.
     *      Applies time lock and non-reentrancy guards. Pausable.
     */
    function requestTokens() external whenNotPaused nonReentrant {
        // Check if enough time has passed
        if (block.timestamp < nextAccessTime[msg.sender]) revert LockTimeNotElapsed();

        uint256 currentWithdrawalAmount = withdrawalAmount; // Cache to avoid re-reading storage
        if (currentWithdrawalAmount == 0) revert WithdrawalAmountNotSet();

        // Check if the faucet contract *itself* has enough CLIS tokens
        uint256 faucetBalance = token.balanceOf(address(this));
        if (faucetBalance < currentWithdrawalAmount) revert FaucetInsufficientBalance();

        // Update user's next access time *before* the external call (security best practice)
        nextAccessTime[msg.sender] = block.timestamp + lockTime;

        // Perform the token transfer *from this contract* to the user
        bool success = token.transfer(msg.sender, currentWithdrawalAmount);
        if (!success) revert TransferFailed();

        // Emit event
        emit Withdrawal(msg.sender, currentWithdrawalAmount);
    }

    // --- Owner Functions ---

    /**
     * @dev Sets the amount of tokens dispensed per withdrawal. Only owner.
     */
    function setWithdrawalAmount(uint256 _newAmount) external onlyOwner {
        if (_newAmount == 0) revert WithdrawAmountMustBePositive();
        withdrawalAmount = _newAmount;
        emit ConfigUpdated("WithdrawalAmount", _newAmount);
    }

    /**
     * @dev Sets the cooldown period between withdrawals. Only owner.
     */
    function setLockTime(uint256 _newLockTime) external onlyOwner {
        if (_newLockTime < 1 minutes) revert LockTimeTooShort();
        lockTime = _newLockTime;
        emit ConfigUpdated("LockTime", _newLockTime);
    }

    /**
     * @dev Allows the owner to withdraw *all remaining* CLIS tokens from the faucet. Only owner. Pausable.
     *      Useful for recovering funds or migrating.
     */
    function ownerWithdrawTokens() external onlyOwner nonReentrant {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return; // Nothing to withdraw

        bool success = token.transfer(owner(), balance); // Transfer to current owner
         if (!success) revert TransferFailed();
    }

    /**
     * @dev Pauses the faucet withdrawals. Only owner.
     */
    function pause() external onlyOwner whenNotPaused {
        _pause();
    }

    /**
     * @dev Unpauses the faucet withdrawals. Only owner.
     */
    function unpause() external onlyOwner whenPaused {
        _unpause();
    }

    // --- View Functions ---

    /**
     * @dev Returns the current CLIS token balance of the faucet contract.
     */
    function getFaucetTokenBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /**
     * @dev Returns the timestamp when the user can next withdraw.
     */
    function getNextAccessTime(address _user) external view returns (uint256) {
        return nextAccessTime[_user];
    }

     /**
      * @dev Helper to check if the faucet is currently paused.
      */
    function isPaused() external view returns (bool) {
        return paused();
    }
}