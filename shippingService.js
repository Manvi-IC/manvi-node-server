// shippingService.js
// This file contains the API integration code to check if a zipcode is serviceable
// by the major logistics providers: DHL, FedEx, UPS, and Aramex.

/**
 * Checks if DHL delivers to a specific zipcode
 * using the MyDHL API (Address Validate endpoint).
 */
export async function checkDhlZipcode(zipcode, countryCode = 'US', cityName = '') {
  try {
    // Note: DHL requires a Base64 encoded Basic Auth string and an API Key
    const authString = Buffer.from(`${process.env.DHL_USERNAME}:${process.env.DHL_PASSWORD}`).toString('base64');
    
    const url = new URL('https://api.dhl.com/mydhlapi/address-validate');
    url.searchParams.append('countryCode', countryCode);
    url.searchParams.append('postalCode', zipcode);
    if (cityName) url.searchParams.append('cityName', cityName);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${authString}`,
        'DHL-API-Key': process.env.DHL_API_KEY,
        'Accept': 'application/json'
      }
    });

    const data = await response.json();
    
    // If the API returns successfully, the address/zipcode is considered valid by DHL
    return response.ok && !data.error;
  } catch (error) {
    console.error("DHL API Error:", error);
    return false;
  }
}

/**
 * Checks if UPS delivers to a specific zipcode
 * using the UPS Address Validation API.
 */
export async function checkUpsZipcode(zipcode, countryCode = 'US') {
  try {
    // 1. First, get an OAuth token from UPS
    const tokenUrl = 'https://onlinetools.ups.com/security/v1/oauth/token';
    const credentials = Buffer.from(`${process.env.UPS_CLIENT_ID}:${process.env.UPS_CLIENT_SECRET}`).toString('base64');
    
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: 'grant_type=client_credentials'
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Call the Address Validation API
    // Request option 1 = Address Validation
    const validateUrl = 'https://onlinetools.ups.com/api/addressvalidation/v2/1?regionalrequestindicator=True';
    const payload = {
      XAVRequest: {
        AddressKeyFormat: {
          PostcodePrimaryLow: zipcode,
          CountryCode: countryCode
        }
      }
    };

    const validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await validateResponse.json();
    
    // Check if the response indicates a valid address classification
    if (result.XAVResponse && result.XAVResponse.Response.ResponseStatus.Code === '1') {
      return true; // Serviceable
    }
    return false;
  } catch (error) {
    console.error("UPS API Error:", error);
    return false;
  }
}

/**
 * Checks if FedEx delivers to a specific zipcode
 * using the FedEx Address Validation API.
 */
export async function checkFedexZipcode(zipcode, countryCode = 'US') {
  try {
    // 1. Get OAuth token from FedEx
    const tokenUrl = 'https://apis.fedex.com/oauth/token';
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.FEDEX_API_KEY,
        client_secret: process.env.FEDEX_SECRET_KEY
      })
    });
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2. Validate Address
    const validateUrl = 'https://apis.fedex.com/address/v1/addresses/resolve';
    const payload = {
      addressesToValidate: [
        {
          address: {
            postalCode: zipcode,
            countryCode: countryCode
          }
        }
      ]
    };

    const validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-locale': 'en_US'
      },
      body: JSON.stringify(payload)
    });

    const result = await validateResponse.json();
    
    // Check if the resolved address is valid for delivery
    if (result.output && result.output.resolvedAddresses) {
      const resolved = result.output.resolvedAddresses[0];
      // FedEx uses 'deliveryPointValidation' (DPV) to confirm it's a valid drop point
      return resolved.deliveryPointValidation === 'CONFIRMED' || resolved.deliveryPointValidation === 'UNCONFIRMED_BUT_PROBABLY_VALID';
    }
    return false;
  } catch (error) {
    console.error("FedEx API Error:", error);
    return false;
  }
}

/**
 * Checks if Aramex delivers to a specific zipcode
 * using the Aramex ValidateAddress API.
 */
export async function checkAramexZipcode(zipcode, countryCode = 'US') {
  try {
    const validateUrl = 'https://ws.aramex.net/ShippingAPI.V2/Location/Service_1_0.svc/json/ValidateAddress';
    
    const payload = {
      ClientInfo: {
        UserName: process.env.ARAMEX_USERNAME,
        Password: process.env.ARAMEX_PASSWORD,
        Version: "v1.0",
        AccountNumber: process.env.ARAMEX_ACCOUNT_NUMBER,
        AccountPin: process.env.ARAMEX_ACCOUNT_PIN,
        AccountEntity: process.env.ARAMEX_ACCOUNT_ENTITY,
        AccountCountryCode: process.env.ARAMEX_ACCOUNT_COUNTRY
      },
      Address: {
        PostCode: zipcode,
        CountryCode: countryCode
      }
    };

    const validateResponse = await fetch(validateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    const result = await validateResponse.json();
    
    // If HasErrors is false, the address is considered valid
    return result && result.HasErrors === false;
  } catch (error) {
    console.error("Aramex API Error:", error);
    return false;
  }
}

/**
 * Utility to run all checks simultaneously.
 */
export async function checkAllCarriers(zipcode, countryCode) {
  const [dhl, ups, fedex, aramex] = await Promise.allSettled([
    checkDhlZipcode(zipcode, countryCode),
    checkUpsZipcode(zipcode, countryCode),
    checkFedexZipcode(zipcode, countryCode),
    checkAramexZipcode(zipcode, countryCode)
  ]);

  return {
    dhl: dhl.status === 'fulfilled' ? dhl.value : false,
    ups: ups.status === 'fulfilled' ? ups.value : false,
    fedex: fedex.status === 'fulfilled' ? fedex.value : false,
    aramex: aramex.status === 'fulfilled' ? aramex.value : false,
    // It's serviceable if at least ONE carrier can deliver
    isServiceable: (dhl.value || ups.value || fedex.value || aramex.value) === true 
  };
}
