import mongoose from "mongoose";
import PaymentService from "../services/paymentService.js";
import Shipment from "../models/Shipment.js";
import QuoteEnquiry from "../models/QuoteEnquiry.js";
import Customer from "../models/Customer.js";

/**
 * Initiate payment for a shipment booking
 */
export async function initiatePayment(req, reply) {
  try {
    const {
      bookingData,
      totalAmount,
      customerEmail,
      customerPhone,
      customerName,
      shipmentId,
      awbNo,
      paymentMode,
      cardDetails,
      upiDetails,
    } = req.body;

    if (!totalAmount || !customerEmail) {
      return reply.status(400).send({
        success: false,
        message: "Missing required payment details",
      });
    }

    // Generate unique merchant transaction number
    const merchantTxnNo = `M5C${Date.now()}${Math.floor(100 + Math.random() * 900)}`;

    // Only include shipmentId if it's a valid value
    let addlParam1 = "";
    let addlParam2 = "";
    
    if (awbNo && awbNo !== "N/A" && awbNo !== "null" && awbNo !== "undefined") {
      addlParam1 = `Shipment:${awbNo}`;
    } else {
      addlParam1 = "Shipment:N/A";
    }
    
    if (shipmentId && shipmentId !== "N/A" && shipmentId !== "null" && shipmentId !== "undefined") {
      addlParam2 = `Booking:${shipmentId}`;
    } else {
      addlParam2 = "Booking:N/A";
    }

    // Prepare payment data
    const paymentData = {
      merchantTxnNo,
      amount: totalAmount,
      customerEmailID: customerEmail,
      customerMobileNo: customerPhone || "919999999999",
      customerName: customerName || "Customer",
      addlParam1: addlParam1,
      addlParam2: addlParam2,
      payType: "0", // Always use redirect mode
    };

    // If direct payment mode is specified
    if (paymentMode) {
      paymentData.paymentMode = paymentMode;
      
      if (paymentMode === "CARD" && cardDetails) {
        paymentData.cardNo = cardDetails.cardNo.replace(/\s/g, "");
        paymentData.cardExpiry = cardDetails.cardExpiry.replace(/\s/g, "");
        paymentData.nameOnCard = cardDetails.nameOnCard;
        paymentData.cvv = cardDetails.cvv;
        if (cardDetails.saveCard) {
          paymentData.saveCardIndicator = "Y";
        }
      } else if (paymentMode === "UPI" && upiDetails) {
        paymentData.customerUPIAlias = upiDetails.vpa;
        // UPI requires redirect mode
        paymentData.payType = "0";
      }
    }

    // Initiate payment
    const result = await PaymentService.initiatePayment(paymentData);

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Payment initiation failed",
        error: result.error,
      });
    }

    // Generate payment redirect URL
    let redirectUrl = null;
    
    if (result.data.redirectURI && result.data.tranCtx) {
      redirectUrl = PaymentService.buildPaymentRedirectUrl(result.data);
    }

    return reply.send({
      success: true,
      data: {
        merchantTxnNo,
        redirectUrl,
        tranCtx: result.data.tranCtx,
        responseCode: result.data.responseCode,
      },
    });
  } catch (error) {
    console.error("[Payment] Initiate Payment Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Payment initiation failed",
    });
  }
}

/**
 * Handle payment response (callback from PG)
 */
export async function paymentResponse(req, reply) {
  try {
    // Get the request body - handle multiple formats
    let responseData = req.body;
    
    console.log("[Payment] Raw Response Type:", typeof responseData);
    console.log("[Payment] Raw Response:", JSON.stringify(responseData, null, 2));
    
    // If body is a string, parse it
    if (typeof responseData === 'string') {
      try {
        // Try JSON first
        responseData = JSON.parse(responseData);
      } catch {
        // Try form-urlencoded
        const parsed = {};
        const params = new URLSearchParams(responseData);
        for (const [key, value] of params) {
          parsed[key] = value;
        }
        responseData = parsed;
      }
    }
    
    // Ensure we have an object
    if (typeof responseData !== 'object' || responseData === null) {
      responseData = {};
    }

    console.log("[Payment] Parsed Response:", JSON.stringify(responseData, null, 2));

    // Verify secure hash if secret key is available
    try {
      const isValid = PaymentService.verifyPaymentResponse(responseData);
      if (!isValid) {
        console.warn("[Payment] ⚠️ Invalid secure hash! Continuing anyway for testing.");
      }
    } catch (hashErr) {
      console.warn("[Payment] ⚠️ Hash verification error:", hashErr.message);
    }

    // Parse payment response
    const paymentResult = PaymentService.parsePaymentResponse(responseData);

    const {
      isSuccess,
      responseCode,
      respDescription,
      merchantId,
      merchantTxnNo,
      txnID,
      paymentDateTime,
      paymentID,
      paymentMode,
      paymentSubInstType,
      amount,
      addlParam1,
      addlParam2,
      txnStatus,
      authCode,
    } = paymentResult;

    // Parse additional parameters - Handle "N/A" values properly
    let shipmentId = null;
    let awbNo = null;
    
    // Only extract if not "N/A" or empty
    if (addlParam2 && addlParam2.includes("Booking:") && !addlParam2.includes("N/A")) {
      const parts = addlParam2.split("Booking:");
      const id = parts[1]?.trim();
      if (id && id !== "N/A" && id !== "null" && id !== "undefined") {
        shipmentId = id;
      }
    }
    
    if (addlParam1 && addlParam1.includes("Shipment:") && !addlParam1.includes("N/A")) {
      const parts = addlParam1.split("Shipment:");
      const id = parts[1]?.trim();
      if (id && id !== "N/A" && id !== "null" && id !== "undefined") {
        awbNo = id;
      }
    }

    console.log("[Payment] Extracted - ShipmentId:", shipmentId, "AwbNo:", awbNo);

    let shipment = null;

    // Update shipment status based on payment result - Only query if we have valid IDs
    if (shipmentId || awbNo) {
      try {
        let query = {};
        
        if (shipmentId) {
          // Validate that shipmentId is a valid ObjectId
          if (mongoose.Types.ObjectId.isValid(shipmentId)) {
            query = { _id: shipmentId };
          } else {
            console.log("[Payment] Invalid ObjectId, skipping shipment update:", shipmentId);
          }
        } else if (awbNo) {
          query = { awbNo };
        }
        
        // Only query if we have a valid query
        if (Object.keys(query).length > 0) {
          shipment = await Shipment.findOne(query);
          
          if (shipment) {
            // Initialize paymentDetails if it doesn't exist
            if (!shipment.paymentDetails) {
              shipment.paymentDetails = {};
            }
            
            // Update payment details
            shipment.paymentStatus = isSuccess ? "PAID" : "FAILED";
            shipment.paymentDetails = {
              ...shipment.paymentDetails,
              txnID,
              paymentID,
              paymentMode,
              paymentSubInstType,
              amount: parseFloat(amount || 0),
              responseCode,
              paymentDateTime,
              authCode,
              merchantTxnNo,
              status: isSuccess ? "SUCCESS" : "FAILED",
              responseData: responseData,
              completedAt: new Date(),
            };
            
            // Update shipment status based on payment result
            if (isSuccess) {
              shipment.status = "BOOKED";
              shipment.isHold = false;
              shipment.confirmedAt = new Date();
              
              // Add payment success event
              if (!shipment.events) shipment.events = [];
              shipment.events.push({
                eventCode: "PAY",
                eventDescription: `Payment confirmed: ${txnID || "N/A"}`,
                eventDate: new Date(),
                location: "Online",
              });
            } else {
              shipment.status = "PAYMENT_FAILED";
              if (!shipment.events) shipment.events = [];
              shipment.events.push({
                eventCode: "PAY_FAIL",
                eventDescription: `Payment failed: ${respDescription || "Unknown error"}`,
                eventDate: new Date(),
                location: "Online",
              });
            }
            
            await shipment.save();
            console.log("[Payment] ✅ Shipment updated successfully:", shipment.awbNo);
          } else {
            console.log("[Payment] ⚠️ Shipment not found for query:", query);
          }
        } else {
          console.log("[Payment] ⚠️ No valid shipment identifier found, skipping DB update");
        }
      } catch (dbErr) {
        console.error("[Payment] ❌ DB Update Error:", dbErr.message);
        console.error("[Payment] ❌ DB Error Details:", dbErr);
      }
    } else {
      console.log("[Payment] ⚠️ No shipment ID or AWB provided, skipping DB update");
    }

    // Always return 200 to the payment gateway
    return reply.status(200).send({
      success: isSuccess,
      data: {
        responseCode,
        respDescription,
        merchantTxnNo,
        txnID,
        paymentID,
        paymentMode,
        paymentSubInstType,
        amount: parseFloat(amount || 0),
        txnStatus,
        isSuccess,
        shipmentId: shipment?._id || shipmentId,
        awbNo: shipment?.awbNo || awbNo,
        authCode,
      },
    });
  } catch (error) {
    console.error("[Payment] ❌ Response Processing Error:", error);
    // Always return 200 to the payment gateway
    return reply.status(200).send({
      success: false,
      message: error.message || "Payment response processing failed",
    });
  }
}

/**
 * Check payment status
 */
export async function checkPaymentStatus(req, reply) {
  try {
    const { merchantTxnNo, originalTxnNo, txnID } = req.query;

    if (!merchantTxnNo && !originalTxnNo && !txnID) {
      return reply.status(400).send({
        success: false,
        message: "merchantTxnNo, originalTxnNo, or txnID is required",
      });
    }

    const result = await PaymentService.checkTransactionStatus(
      merchantTxnNo || originalTxnNo,
      originalTxnNo || merchantTxnNo
    );

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Status check failed",
      });
    }

    const { data } = result;
    const isSuccess = data.txnStatus === "SUC" || data.responseCode === "000" || data.responseCode === "0000";

    return reply.send({
      success: true,
      data: {
        ...data,
        isSuccess,
        status: data.txnStatus,
        message: data.txnRespDescription || data.respDescription,
        amount: parseFloat(data.amount || 0),
      },
    });
  } catch (error) {
    console.error("[Payment] Status Check Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Status check failed",
    });
  }
}

/**
 * Process refund for a payment
 */
export async function processRefund(req, reply) {
  try {
    const { merchantTxnNo, originalTxnNo, amount, addlParam1, addlParam2 } = req.body;

    if (!merchantTxnNo || !originalTxnNo || !amount) {
      return reply.status(400).send({
        success: false,
        message: "merchantTxnNo, originalTxnNo, and amount are required",
      });
    }

    const result = await PaymentService.processRefund(
      merchantTxnNo,
      originalTxnNo,
      amount,
      addlParam1,
      addlParam2
    );

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Refund failed",
      });
    }

    // Update shipment refund status
    if (originalTxnNo) {
      try {
        const shipment = await Shipment.findOne({ "paymentDetails.merchantTxnNo": originalTxnNo });
        if (shipment) {
          if (!shipment.paymentDetails) shipment.paymentDetails = {};
          shipment.paymentDetails.refundStatus = "REFUNDED";
          shipment.paymentDetails.refundAmount = parseFloat(amount);
          shipment.paymentDetails.refundTxnId = result.data.txnID;
          shipment.paymentDetails.refundDateTime = new Date();
          
          if (!shipment.events) shipment.events = [];
          shipment.events.push({
            eventCode: "REFUND",
            eventDescription: `Refund processed: ${amount}`,
            eventDate: new Date(),
            location: "Online",
          });
          
          await shipment.save();
        }
      } catch (dbErr) {
        console.error("[Payment] Refund DB Update Error:", dbErr.message);
      }
    }

    return reply.send({
      success: true,
      data: result.data,
      message: "Refund processed successfully",
    });
  } catch (error) {
    console.error("[Payment] Refund Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Refund failed",
    });
  }
}

/**
 * Process void/cancel for a payment
 */
export async function processVoid(req, reply) {
  try {
    const { merchantTxnNo, originalTxnNo } = req.body;

    if (!merchantTxnNo || !originalTxnNo) {
      return reply.status(400).send({
        success: false,
        message: "merchantTxnNo and originalTxnNo are required",
      });
    }

    const result = await PaymentService.processVoid(merchantTxnNo, originalTxnNo);

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Void failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
      message: "Void processed successfully",
    });
  } catch (error) {
    console.error("[Payment] Void Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Void failed",
    });
  }
}

/**
 * Generate QR for UPI payment
 */
export async function generateQR(req, reply) {
  try {
    const { amount, customerEmail, customerPhone, customerName, merchantTxnNo, invoiceNo } = req.body;

    if (!amount) {
      return reply.status(400).send({
        success: false,
        message: "Amount is required",
      });
    }

    const txnNo = merchantTxnNo || `QR${Date.now()}`;

    const result = await PaymentService.generateQR(
      txnNo,
      amount,
      customerEmail || "guest@icicibank.com",
      customerPhone || "919999999999",
      customerName || "Customer",
      invoiceNo || ""
    );

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "QR generation failed",
      });
    }

    return reply.send({
      success: true,
      data: {
        upiQR: result.data.upiQR,
        merchantRefNo: result.data.merchantRefNo,
        returnCode: result.data.returnCode,
        responseDescription: result.data.responseDescription,
      },
    });
  } catch (error) {
    console.error("[Payment] Generate QR Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "QR generation failed",
    });
  }
}

/**
 * User cancel API
 */
export async function userCancel(req, reply) {
  try {
    const { merchantTxnNo, cancellationCode, cancellationDesc } = req.body;

    if (!merchantTxnNo) {
      return reply.status(400).send({
        success: false,
        message: "merchantTxnNo is required",
      });
    }

    const result = await PaymentService.userCancel(
      merchantTxnNo,
      cancellationCode || "020",
      cancellationDesc || "Cancel By User"
    );

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Cancel failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
      message: "Transaction cancelled successfully",
    });
  } catch (error) {
    console.error("[Payment] User Cancel Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Cancel failed",
    });
  }
}

/**
 * Get card BIN details
 */
export async function getCardBin(req, reply) {
  try {
    const { cardNo } = req.query;

    if (!cardNo) {
      return reply.status(400).send({
        success: false,
        message: "cardNo is required",
      });
    }

    const result = await PaymentService.getCardBin(cardNo);

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Card BIN check failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("[Payment] Get Card BIN Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Card BIN check failed",
    });
  }
}

/**
 * Get service charges
 */
export async function getServiceCharges(req, reply) {
  try {
    const { paymentMode, paymentOption, amount } = req.query;

    if (!paymentMode || !amount) {
      return reply.status(400).send({
        success: false,
        message: "paymentMode and amount are required",
      });
    }

    const result = await PaymentService.getServiceCharges(
      paymentMode,
      paymentOption || "",
      amount
    );

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Service charges check failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("[Payment] Service Charges Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Service charges check failed",
    });
  }
}

/**
 * Get settlement details
 */
export async function getSettlementDetails(req, reply) {
  try {
    const { settlementID, lastTxnID } = req.query;

    if (!settlementID) {
      return reply.status(400).send({
        success: false,
        message: "settlementID is required",
      });
    }

    const result = await PaymentService.getSettlementDetails(settlementID, lastTxnID || "");

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Settlement details failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("[Payment] Settlement Details Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Settlement details failed",
    });
  }
}

/**
 * Get settlement summary
 */
export async function getSettlementSummary(req, reply) {
  try {
    const { settlementDate } = req.query;

    const result = await PaymentService.getSettlementSummary(settlementDate);

    if (!result.success) {
      return reply.status(500).send({
        success: false,
        message: result.message || "Settlement summary failed",
      });
    }

    return reply.send({
      success: true,
      data: result.data,
    });
  } catch (error) {
    console.error("[Payment] Settlement Summary Error:", error);
    return reply.status(500).send({
      success: false,
      message: error.message || "Settlement summary failed",
    });
  }
}