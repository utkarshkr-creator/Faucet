import React, { useState, useEffect, useCallback } from 'react';
import { ethers, BrowserProvider, Contract, formatUnits, parseUnits } from 'ethers';
import './App.css'; // Basic styling

// Import ABIs and Addresses
import {MyTokenABI} from './contracts/addresses';
import {FaucetABI} from './contracts/addresses';
import { myTokenAddress, faucetAddress, targetChainId, targetNetworkName } from './contracts/addresses';
import { FAUCET_COOLDOWN_SECONDS, FAUCET_DISPENSE_AMOUNT_WEI, TOKEN_DECIMALS, TOKEN_SYMBOL } from './config';

declare global {
  interface Window {
    ethereum?: any; // Define ethereum property on window
  }
}

function App() {
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [signer, setSigner] = useState<ethers.Signer | null>(null);
  const [userAddress, setUserAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<ethers.Network | null>(null);

  const [tokenContract, setTokenContract] = useState<Contract | null>(null);
  const [faucetContract, setFaucetContract] = useState<Contract | null>(null);

  const [userTokenBalance, setUserTokenBalance] = useState<string>("0");
  const [faucetTokenBalance, setFaucetTokenBalance] = useState<string>("0");

  const [isRequesting, setIsRequesting] = useState<boolean>(false);
  const [txMessage, setTxMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const [nextEligibleTime, setNextEligibleTime] = useState<number>(0); // Timestamp in seconds
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0); // Remaining seconds

  const isWalletConnected = Boolean(userAddress);
  const isCorrectNetwork = network?.chainId === BigInt(targetChainId);

  // ---- Connection & Setup ----

  const connectWallet = useCallback(async () => {
    setErrorMessage("");
    if (!window.ethereum) {
      setErrorMessage("MetaMask (or another Ethereum wallet) is not installed. Please install it.");
      return;
    }

    try {
      // Request account access
      await window.ethereum.request({ method: 'eth_requestAccounts' });

      // Initialize provider and signer
      const web3Provider = new ethers.BrowserProvider(window.ethereum);
      const web3Signer = await web3Provider.getSigner();
      const web3Network = await web3Provider.getNetwork();
      const address = await web3Signer.getAddress();

      setProvider(web3Provider);
      setSigner(web3Signer);
      setUserAddress(address);
      setNetwork(web3Network);

      // Add listeners for account/network changes
      window.ethereum.removeAllListeners(); // Remove previous listeners first

      window.ethereum.on('accountsChanged', (accounts: string[]) => {
        console.log("Account changed");
        if (accounts.length > 0) {
          setUserAddress(accounts[0]);
          // Re-fetch signer as it might be tied to the old account implicitly
          web3Provider.getSigner().then(setSigner).catch(console.error);
        } else {
          // Handle disconnection
          disconnectWallet();
        }
      });

      window.ethereum.on('chainChanged', (/* chainId: string */) => {
        console.log("Network changed");
        // Reload the page to ensure correct network context - recommended by MetaMask
        window.location.reload();
      });

    } catch (error: any) {
      console.error("Connection Error:", error);
      setErrorMessage(error?.message || "Failed to connect wallet.");
    }
  }, []); // No dependencies needed for initial connect logic

  const disconnectWallet = () => {
    setProvider(null);
    setSigner(null);
    setUserAddress(null);
    setNetwork(null);
    setTokenContract(null);
    setFaucetContract(null);
    setUserTokenBalance("0");
    setFaucetTokenBalance("0");
    setNextEligibleTime(0);
    setCooldownRemaining(0);
    setTxMessage("");
    setErrorMessage("");
     if (window.ethereum?.removeAllListeners) {
       window.ethereum.removeAllListeners();
     }
  };


  // ---- Contract Initialization ----

  useEffect(() => {
    if (provider && isCorrectNetwork) {
        const tokenInstance = new Contract(myTokenAddress, MyTokenABI, provider);
        // Need signer for faucet write operations
        const faucetInstance = signer ? new Contract(faucetAddress, FaucetABI, signer) : new Contract(faucetAddress, FaucetABI, provider);
        setTokenContract(tokenInstance);
        setFaucetContract(faucetInstance);
    } else {
        setTokenContract(null);
        setFaucetContract(null);
    }
  }, [provider, signer, isCorrectNetwork]);


  // ---- Data Fetching ----

  const fetchBalances = useCallback(async () => {
    if (tokenContract && faucetContract && userAddress) {
        try {
            const [userBalWei, faucetBalWei] = await Promise.all([
                tokenContract.balanceOf(userAddress),
                tokenContract.balanceOf(faucetAddress)
            ]);
            setUserTokenBalance(formatUnits(userBalWei, TOKEN_DECIMALS));
            setFaucetTokenBalance(formatUnits(faucetBalWei, TOKEN_DECIMALS));
        } catch (err) {
            console.error("Error fetching balances:", err);
            setErrorMessage("Could not fetch token balances.");
        }
    }
  }, [tokenContract, faucetContract, userAddress]); // Include faucetContract here


  const fetchNextEligibleTime = useCallback(async () => {
     if (faucetContract && userAddress) {
        try {
             // Make sure to use the faucet contract instance *with a provider* for read calls if signer isn't strictly needed
             const faucetReader = provider ? new Contract(faucetAddress, FaucetABI, provider) : faucetContract;
             const nextTime = await faucetReader.getNextEligibleTime(userAddress);
             setNextEligibleTime(Number(nextTime)); // Convert BigInt to number for calculations
        } catch (err) {
            console.error("Error fetching next eligible time:", err);
             // Don't necessarily show an error, could just mean user never requested
        }
     }
  }, [faucetContract, userAddress, provider]);

  // Initial fetch and periodic refresh for balances
  useEffect(() => {
      if (isWalletConnected && isCorrectNetwork) {
          fetchBalances();
          const interval = setInterval(fetchBalances, 15000); // Refresh every 15s
          return () => clearInterval(interval);
      }
  }, [isWalletConnected, isCorrectNetwork, fetchBalances]);


  // Initial fetch for cooldown status
  useEffect(() => {
      if (isWalletConnected && isCorrectNetwork) {
          fetchNextEligibleTime();
      }
  }, [isWalletConnected, isCorrectNetwork, fetchNextEligibleTime]);

  // ---- Cooldown Timer Logic ----
  useEffect(() => {
    if (nextEligibleTime <= 0) {
      setCooldownRemaining(0);
      return;
    }

    const updateTimer = () => {
        const nowSeconds = Math.floor(Date.now() / 1000);
        const remaining = nextEligibleTime - nowSeconds;
        setCooldownRemaining(remaining > 0 ? remaining : 0);
    };

    updateTimer(); // Run immediately
    const timerInterval = setInterval(updateTimer, 1000); // Update every second

    // Cleanup interval on component unmount or when eligibility changes
    return () => clearInterval(timerInterval);

  }, [nextEligibleTime]);


  // ---- Faucet Interaction ----

  const handleRequestTokens = async () => {
    if (!faucetContract || !signer) {
      setErrorMessage("Faucet contract not loaded or wallet not fully connected.");
      return;
    }
    if (cooldownRemaining > 0) {
      setErrorMessage(`Please wait ${cooldownRemaining} more seconds.`);
      return;
    }

    setIsRequesting(true);
    setTxMessage("");
    setErrorMessage("");

    try {
      // IMPORTANT: Need the contract instance connected to the signer for transactions
      const faucetWithSigner = new Contract(faucetAddress, FaucetABI, signer);

      setTxMessage("Waiting for transaction confirmation...");
      const tx = await faucetWithSigner.requestTokens();
      setTxMessage(`Transaction sent! Waiting for mining... Hash: ${tx.hash}`);

      // Wait for the transaction to be mined
      const receipt = await tx.wait(); // wait for 1 confirmation by default

      if(receipt.status === 1) {
        setTxMessage(`Success! ${formatUnits(FAUCET_DISPENSE_AMOUNT_WEI, TOKEN_DECIMALS)} ${TOKEN_SYMBOL} received. Tx: ${receipt.hash}`);
        // Refetch data immediately after success
        await fetchBalances();
        await fetchNextEligibleTime(); // This will update the cooldown
      } else {
        setErrorMessage(`Transaction failed. Status: ${receipt.status}. Tx: ${receipt.hash}`);
      }


    } catch (error: any) {
      console.error("Faucet request error:", error);
      let userFriendlyError = "Faucet request failed.";
      if (error.code === 'ACTION_REJECTED') {
          userFriendlyError = "Transaction rejected by user.";
      } else if (error?.data?.message) { // Try to get revert reason (ethers v5 syntax might differ)
           userFriendlyError = `Transaction failed: ${error.data.message}`;
       } else if (error?.reason) { // Newer Ethers v6 might have a reason field
            userFriendlyError = `Transaction failed: ${error.reason}`;
      } else if (error?.message) {
          if (error.message.includes("Cooldown period not met")) {
               userFriendlyError = "Cooldown period not met. Please wait.";
               // Optionally re-sync the cooldown time if mismatch detected
               fetchNextEligibleTime();
          } else if (error.message.includes("Not enough tokens")) {
              userFriendlyError = "Faucet is empty or has insufficient funds.";
          } else {
              userFriendlyError = error.message; // Fallback to raw message
          }
      }
      setErrorMessage(userFriendlyError);
    } finally {
      setIsRequesting(false);
      // Keep success/error message until next action, maybe clear after a timeout?
      // setTimeout(() => { setTxMessage(""); setErrorMessage(""); }, 10000); // Clear after 10s
    }
  };


  // ---- Network Switch ----
   const switchNetwork = async () => {
     if (!window.ethereum) {
       setErrorMessage("Wallet not detected.");
       return;
     }
     try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${targetChainId.toString(16)}` }], // chainId must be in hex format
        });
        // Re-initialize provider after network switch? Or let the chainChanged listener handle it.
        // Let's rely on chainChanged listener reloading the page.
     } catch (switchError: any) {
       // This error code indicates that the chain has not been added to MetaMask.
       // TODO: Add network if needed (requires more parameters like RPC URL)
       if (switchError.code === 4902) {
           setErrorMessage(`Network ${targetNetworkName} not found in wallet. Please add it manually.`);
            // You could try adding the network programmatically here if you have the RPC details
            // await window.ethereum.request({ method: 'wallet_addEthereumChain', params: [...] });
       } else {
         console.error("Failed to switch network:", switchError);
         setErrorMessage("Failed to switch network.");
       }
     }
   };

  // ---- Render ----
  return (
    <div className="App">
      <h1>MyToken ({TOKEN_SYMBOL}) Faucet</h1>

      {/* Connection Button */}
      {!isWalletConnected ? (
        <button onClick={connectWallet}>Connect Wallet</button>
      ) : (
        <button onClick={disconnectWallet}>Disconnect Wallet</button>
      )}

      {/* Wallet Info */}
      {userAddress && (
        <div>
          <p>Connected Account: {userAddress.substring(0, 6)}...{userAddress.substring(userAddress.length - 4)}</p>
           {network && <p>Network: {network.name} (ID: {network.chainId.toString()})</p>}
          {!isCorrectNetwork && network && (
              <p style={{ color: 'orange' }}>
                  Wrong Network! Please switch to {targetNetworkName}.
                  <button onClick={switchNetwork} style={{ marginLeft: '10px' }}>Switch to {targetNetworkName}</button>
              </p>
          )}
        </div>
      )}

      {/* Display Balances */}
       {isWalletConnected && isCorrectNetwork && tokenContract && (
            <div>
               <p>Your {TOKEN_SYMBOL} Balance: {parseFloat(userTokenBalance).toFixed(4)}</p>
               <p>Faucet {TOKEN_SYMBOL} Balance: {parseFloat(faucetTokenBalance).toFixed(4)}</p>
            </div>
       )}

      {/* Faucet Interaction */}
      {isWalletConnected && isCorrectNetwork && faucetContract && (
        <div>
          <button
            onClick={handleRequestTokens}
            disabled={isRequesting || cooldownRemaining > 0 || !signer } // Disable if requesting, on cooldown, or signer not ready
          >
            {isRequesting ? 'Requesting...' :
             cooldownRemaining > 0 ? `Wait ${cooldownRemaining}s` :
             `Request ${formatUnits(FAUCET_DISPENSE_AMOUNT_WEI, TOKEN_DECIMALS)} ${TOKEN_SYMBOL}`}
          </button>
           {cooldownRemaining > 0 && <p style={{ color: 'grey' }}>Cooldown active.</p>}
        </div>
      )}

       {/* Messages */}
        {txMessage && <p style={{ color: 'green' }}>{txMessage}</p>}
        {errorMessage && <p style={{ color: 'red' }}>Error: {errorMessage}</p>}


        {/* Prompt to connect or switch network */}
        {!isWalletConnected && <p>Please connect your wallet to use the faucet.</p>}
        {isWalletConnected && !isCorrectNetwork && network && <p>Please switch to the {targetNetworkName} network.</p>}


    </div>
  );
}

export default App;