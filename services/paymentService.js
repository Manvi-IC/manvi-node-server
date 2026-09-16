import crypto from "crypto";
import axios from "axios";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

class PaymentService {
  constructor() {
    // Load environment variables
    this.merchantId = process.env.PG_MERCHANT_ID;
    this.aggregatorId = process.env.PG_AGGREGATOR_ID;
    this.secretKey = process.env.PG_SECRET_KEY;
    this.initiateSaleUrl = process.env.PG_INITIATE_SALE_URL;
    this.commandUrl = process.env.PG_COMMAND_URL;
    this.generateQrUrl = process.env.PG_GENERATE_QR_URL;
    this.settlementDetailsUrl = process.env.PG_SETTLEMENT_DETAILS_URL;
    this.userCancelUrl = process.env.PG_USER_CANCEL_URL;
    this.returnUrl = process.env.PG_RETURN_URL;
    this.currencyCode = process.env.PG_CURRENCY_CODE || "356";
    this.payType = process.env.PG_PAY_TYPE || "0";
    this.environment = process.env.PG_ENVIRONMENT || "UAT";

    console.log("\n========================================");
    console.log("🔑 Payment Service Configuration");
    console.log("========================================");
    console.log(`Merchant ID: ${this.merchantId ? "✅ Set" : "❌ Missing"}`);
    console.log(`Aggregator ID: ${this.aggregatorId ? "✅ Set" : "❌ Missing"}`);
    console.log(`Secret Key: ${this.secretKey ? `✅ Set (${this.secretKey.length} chars)` : "❌ Missing"}`);
    console.log(`Initiate Sale URL: ${this.initiateSaleUrl ? "✅ Set" : "❌ Missing"}`);
    console.log(`Return URL: ${this.returnUrl ? "✅ Set" : "❌ Missing"}`);
    console.log(`Environment: ${this.environment}`);
    console.log("========================================\n");
  }

  /**
   * Get secret key with validation
   */
  getSecretKey() {
    if (!this.secretKey) {
      throw new Error("PG_SECRET_KEY is not configured. Please check your .env file.");
    }
    return this.secretKey;
  }

  /**
   * Generate secure hash for payment request (V1 - for form-urlencoded)
   */
  generateSecureHash(requestData) {
    const secretKey = this.getSecretKey();
    
    // Sort keys alphabetically
    const sortedKeys = Object.keys(requestData).sort();
    
    // Build plain text by concatenating values in alphabetical order of keys
    let plainText = "";
    for (const key of sortedKeys) {
      const value = requestData[key];
      if (value !== null && value !== undefined && value !== "") {
        plainText += value;
      }
    }

    // Generate HMAC SHA256 hash
    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(plainText)
      .digest("hex");

    return hash.toLowerCase();
  }

  /**
   * Generate secure hash for JSON request (V2)
   */
  generateSecureHashV2(jsonObject) {
    const secretKey = this.getSecretKey();
    
    // Convert to minified JSON string
    const jsonString = JSON.stringify(jsonObject);
    
    // Generate HMAC SHA256 hash
    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(jsonString)
      .digest("hex");

    return hash.toLowerCase();
  }

  /**
   * Generate secure hash for command API (status, refund, etc.)
   */
  generateCommandHash(requestData) {
    const secretKey = this.getSecretKey();
    
    const sortedKeys = Object.keys(requestData).sort();
    let plainText = "";
    for (const key of sortedKeys) {
      const value = requestData[key];
      if (value !== null && value !== undefined && value !== "") {
        plainText += value;
      }
    }

    const hash = crypto
      .createHmac("sha256", secretKey)
      .update(plainText)
      .digest("hex");

    return hash.toLowerCase();
  }

  /**
   * Initiate a payment transaction
   */
  async initiatePayment(paymentData) {
    try {
      // Validate configuration before making request
      this.getSecretKey();
      
      if (!this.merchantId) {
        throw new Error("PG_MERCHANT_ID is not configured");
      }
      if (!this.initiateSaleUrl) {
        throw new Error("PG_INITIATE_SALE_URL is not configured");
      }

      const {
        merchantTxnNo,
        amount,
        customerEmailID,
        customerMobileNo,
        customerName,
        addlParam1 = "",
        addlParam2 = "",
        payType = this.payType,
        returnURL = this.returnUrl,
        paymentMode = null,
        cardNo = null,
        cardExpiry = null,
        nameOnCard = null,
        cvv = null,
        customerUPIAlias = null,
        saveCardIndicator = "N",
        authOnlyIndicator = "N",
      } = paymentData;

      // Build request data
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo,
        amount: parseFloat(amount).toFixed(2),
        currencyCode: this.currencyCode,
        payType,
        customerEmailID,
        transactionType: "SALE",
        returnURL: returnURL || this.returnUrl,
        txnDate: new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14),
        customerMobileNo: customerMobileNo || "919999999999",
        customerName: customerName || "Customer",
        addlParam1: addlParam1 || "",
        addlParam2: addlParam2 || "",
      };

      // Add payment mode specific fields
      if (paymentMode) {
        requestData.paymentMode = paymentMode;
        
        if (paymentMode === "CARD") {
          if (cardNo) requestData.cardNo = cardNo.replace(/\s/g, "");
          if (cardExpiry) requestData.cardExpiry = cardExpiry.replace(/\s/g, "");
          if (nameOnCard) requestData.nameOnCard = nameOnCard;
          if (cvv) requestData.cvv = cvv;
          if (saveCardIndicator === "Y") {
            requestData.saveCardIndicator = "Y";
          }
          if (authOnlyIndicator === "Y") {
            requestData.authOnlyIndicator = "Y";
          }
        } else if (paymentMode === "UPI") {
          if (customerUPIAlias) {
            requestData.customerUPIAlias = customerUPIAlias;
          }
          // For UPI, we need to set payType to 0 (redirect mode)
          requestData.payType = "0";
        }
      }

      // Generate secure hash
      const secureHash = this.generateSecureHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Initiate Sale Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
        cvv: requestData.cvv ? "***" : undefined,
      }, null, 2));

      const response = await axios.post(this.initiateSaleUrl, requestData, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 60000,
      });

      console.log("[Payment] Initiate Sale Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Initiate Sale Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.responseDescription || error.message || "Payment initiation failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Build payment redirect URL
   */
  buildPaymentRedirectUrl(initiateResponse) {
    if (!initiateResponse.redirectURI || !initiateResponse.tranCtx) {
      throw new Error("Missing redirectURI or tranCtx in response");
    }
    return `${initiateResponse.redirectURI}?tranCtx=${initiateResponse.tranCtx}`;
  }

  /**
   * Verify payment response hash
   */
  verifyPaymentResponse(responseData) {
    try {
      // If secret key is not set, skip verification (for testing)
      if (!this.secretKey) {
        console.warn("[Payment] Secret key not configured, skipping hash verification");
        return true;
      }

      const { secureHash, ...rest } = responseData;
      const sortedKeys = Object.keys(rest).sort();
      let plainText = "";
      for (const key of sortedKeys) {
        const value = rest[key];
        if (value !== null && value !== undefined && value !== "") {
          plainText += value;
        }
      }

      const calculatedHash = crypto
        .createHmac("sha256", this.secretKey)
        .update(plainText)
        .digest("hex")
        .toLowerCase();

      const isValid = calculatedHash === secureHash?.toLowerCase();
      if (!isValid) {
        console.warn("[Payment] Hash mismatch. Calculated:", calculatedHash, "Received:", secureHash);
      }
      return isValid;
    } catch (error) {
      console.error("[Payment] Hash verification error:", error);
      return true;
    }
  }

  /**
   * Check transaction status - uses x-www-form-urlencoded
   */
  async checkTransactionStatus(merchantTxnNo, originalTxnNo) {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo: merchantTxnNo || originalTxnNo,
        originalTxnNo: originalTxnNo || merchantTxnNo,
        transactionType: "STATUS",
      };

      const secureHash = this.generateCommandHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Status Check Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.commandUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Status Check Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Status Check Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.respDescription || error.message || "Status check failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Process refund - uses x-www-form-urlencoded
   */
  async processRefund(merchantTxnNo, originalTxnNo, amount, addlParam1 = "", addlParam2 = "") {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo,
        originalTxnNo,
        amount: parseFloat(amount).toFixed(2),
        transactionType: "REFUND",
        addlParam1,
        addlParam2,
      };

      const secureHash = this.generateCommandHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Refund Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.commandUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Refund Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Refund Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.respDescription || error.message || "Refund failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Process void/cancel - uses x-www-form-urlencoded
   */
  async processVoid(merchantTxnNo, originalTxnNo) {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo,
        originalTxnNo,
        amount: "0.00",
        transactionType: "VOID",
      };

      const secureHash = this.generateCommandHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Void Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.commandUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Void Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Void Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.respDescription || error.message || "Void failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Generate QR code for UPI payment - uses application/json
   */
  async generateQR(merchantRefNo, amount, customerEmailID, customerMobileNo, customerName, invoiceNo = "") {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantRefNo,
        amount: parseFloat(amount).toFixed(2),
        currency: this.currencyCode,
        emailID: customerEmailID || "guest@icicibank.com",
        mobileNo: customerMobileNo || "919999999999",
        requestType: "UPIQR",
      };

      if (invoiceNo) requestData.invoiceNo = invoiceNo;

      const secureHash = this.generateSecureHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Generate QR Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const response = await axios.post(this.generateQrUrl, requestData, {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 30000,
      });

      console.log("[Payment] Generate QR Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Generate QR Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.responseDescription || error.message || "QR generation failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Get settlement details - uses x-www-form-urlencoded
   */
  async getSettlementDetails(settlementID, lastTxnID = "") {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        settlementID,
        lastTxnID,
      };

      const secureHash = this.generateSecureHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Settlement Details Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.settlementDetailsUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Settlement Details Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Settlement Details Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errorDescription || error.message || "Settlement details failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Get settlement summary - uses x-www-form-urlencoded
   */
  async getSettlementSummary(settlementDate) {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        settlementDate: settlementDate || new Date().toISOString().slice(0, 10).replace(/-/g, ""),
        transactionType: "SETTLEMENTSUMMARY",
      };

      const secureHash = this.generateCommandHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Settlement Summary Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.commandUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Settlement Summary Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Settlement Summary Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errorDescription || error.message || "Settlement summary failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Get card BIN details - uses application/json
   */
  async getCardBin(cardNo) {
    try {
      const requestId = `BIN${Date.now()}`;
      const requestedAt = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);

      const requestData = {
        merchantId: this.merchantId,
        requestId,
        requestedAt,
        cardNo: cardNo.replace(/\s/g, "").slice(0, 10),
      };

      const secureHash = this.generateSecureHashV2(requestData);
      
      const response = await axios.post(
        "https://pgpayuat.icicibank.com/tsp/pg/api/getCardBin",
        requestData,
        {
          headers: {
            "Content-Type": "application/json",
            "securehash": secureHash,
          },
          timeout: 30000,
        }
      );

      console.log("[Payment] Card BIN Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Card BIN Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.errorDescription || error.message || "Card BIN check failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * User cancel API - uses application/json
   */
  async userCancel(merchantTxnNo, cancellationCode = "020", cancellationDesc = "Cancel By User") {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo,
        cancellationCode,
        cancellationDesc,
      };

      const secureHash = this.generateSecureHashV2(requestData);

      const response = await axios.post(this.userCancelUrl, requestData, {
        headers: {
          "Content-Type": "application/json",
          "securehash": secureHash,
        },
        timeout: 30000,
      });

      console.log("[Payment] User Cancel Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] User Cancel Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.respDescription || error.message || "Cancel failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Get service charges - uses x-www-form-urlencoded
   */
  async getServiceCharges(paymentMode, paymentOption, amount, merchantTxnNo = null) {
    try {
      const requestData = {
        merchantId: this.merchantId,
        aggregatorID: this.aggregatorId,
        merchantTxnNo: merchantTxnNo || `CHG${Date.now()}`,
        paymentMode,
        paymentOptionCodes: paymentOption || "",
        amount: parseFloat(amount).toFixed(2),
        currencyCode: this.currencyCode,
      };

      const secureHash = this.generateCommandHash(requestData);
      requestData.secureHash = secureHash;

      console.log("[Payment] Service Charges Request:", JSON.stringify({
        ...requestData,
        secureHash: "***HIDDEN***",
      }, null, 2));

      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(requestData)) {
        if (value !== null && value !== undefined) {
          params.append(key, String(value));
        }
      }

      const response = await axios.post(this.commandUrl, params.toString(), {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        timeout: 30000,
      });

      console.log("[Payment] Service Charges Response:", JSON.stringify(response.data, null, 2));

      return {
        success: true,
        data: response.data,
      };
    } catch (error) {
      console.error("[Payment] Service Charges Error:", error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.respDescription || error.message || "Service charges failed",
        error: error.response?.data || error.message,
      };
    }
  }

  /**
   * Parse payment response from PG
   */
  parsePaymentResponse(responseData) {
    const isSuccess = responseData.responseCode === "000" || 
                     responseData.responseCode === "0000" ||
                     responseData.txnStatus === "SUC";

    return {
      isSuccess,
      responseCode: responseData.responseCode,
      respDescription: responseData.respDescription || responseData.txnRespDescription,
      merchantId: responseData.merchantId,
      merchantTxnNo: responseData.merchantTxnNo,
      txnID: responseData.txnID,
      paymentID: responseData.paymentID || responseData.txnAuthID,
      paymentMode: responseData.paymentMode,
      paymentSubInstType: responseData.paymentSubInstType,
      amount: parseFloat(responseData.amount || 0),
      paymentDateTime: responseData.paymentDateTime,
      txnStatus: responseData.txnStatus,
      authCode: responseData.authCode,
      customerEmailID: responseData.customerEmailID,
      customerMobileNo: responseData.customerMobileNo,
      addlParam1: responseData.addlParam1,
      addlParam2: responseData.addlParam2,
      cardNetwork: responseData.cardNetwork,
      cardType: responseData.cardType,
      tokenReferenceId: responseData.tokenReferenceId,
      panReferenceId: responseData.panReferenceId,
      tokenReferenceIdHash: responseData.tokenReferenceIdHash,
      nwAuthRefNo: responseData.nwAuthRefNo,
    };
  }
}

export default new PaymentService();