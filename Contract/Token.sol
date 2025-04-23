// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol"; // Use new Ownable v5

/**
 * @title ClisToken
 * @dev A simple ERC20 token named ClisToken with symbol CLIS.
 *      Owner can mint new tokens.
 */
contract ClisToken is ERC20, Ownable {
    // Event to log minting
    event TokensMinted(address indexed to, uint256 amount);

    /**
     * @dev Sets the token name, symbol, and initial owner.
     * @param initialOwner The address that will initially own the contract and minting rights.
     */
    constructor(address initialOwner)
        ERC20("ClisToken", "CLIS")
        Ownable(initialOwner) // Pass initial owner for Ownable v5
    {
        // Optionally mint some initial supply to the deployer upon creation
        // _mint(initialOwner, 1000000 * (10**decimals())); // Example: Mint 1M tokens
    }

    /**
     * @dev Creates `amount` tokens and assigns them to `account`, increasing
     * the total supply. Only callable by the owner.
     * Emits a {TokensMinted} event.
     * Requirements:
     * - `account` cannot be the zero address.
     */
    function mint(address account, uint256 amount) public onlyOwner {
        require(account != address(0), "ERC20: mint to the zero address");
        _mint(account, amount); // Use internal ERC20 _mint function
        emit TokensMinted(account, amount);
    }

    /**
     * @dev Public view function to easily check token decimals.
     */
    function getDecimals() public view returns (uint8) {
        return decimals(); // Returns the decimals value set by ERC20 (default 18)
    }
}