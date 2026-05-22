const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

// Define the secret parameter. The value will be injected securely from Secret Manager.
const geminiApiKey = defineSecret("GEMINI_API_KEY");

exports.extractPurchaseAgreementData = onCall({
    secrets: [geminiApiKey],
    cors: true, 
    maxInstances: 10,
    invoker: "public"
}, async (request) => {
    // request.data contains the payload sent from the client
    const fullText = request.data.text;
    
    if (!fullText || typeof fullText !== 'string') {
        throw new HttpsError('invalid-argument', 'The function must be called with a "text" field containing the PDF text.');
    }

    try {
        const apiKey = geminiApiKey.value().trim();
        
        const prompt = `
You are a highly accurate real estate contract parsing assistant.
I will provide the raw text of a Purchase Agreement. 
CRITICAL RULE: Many forms contain printed boilerplate default values (e.g. "17 Days"). You MUST prioritize explicitly filled-in, typed, or handwritten override numbers over the printed defaults. Carefully scan the text near the contingency clauses to see if a custom number of days was written in by the buyer.
CRITICAL RULE 2: PDF text extraction scrambles checkboxes. Do NOT attempt to extract the Financing Type.
CRITICAL RULE 3: For the Agent information, you MUST ONLY extract the BUYER'S Brokerage Firm and BUYER'S Agent. Specifically locate the section titled "Buyer's Brokerage Firm" (usually on the last page). NEVER extract the Seller's Brokerage Firm or Seller's Agent.
CRITICAL RULE 4: Extract the Buyer's Name specifically from Section 1A of the Purchase Agreement.

Extract the following information and return ONLY a valid JSON object matching this exact structure:
{
  "buyerName": "string or null",
  "buyerBrokerage": "string or null",
  "buyerBrokerageDre": "string or null",
  "buyerAgent": "string or null",
  "buyerAgentDre": "string or null",
  "buyerAgentEmail": "string or null",
  "buyerAgentPhone": "string or null",
  "purchasePrice": "number (no commas or symbols) or null",
  "initialDeposit": "number (no commas or symbols) or null",
  "loanAmount": "number (no commas or symbols) or null",
  "coeDays": "number (days) or null",
  "sellerCredit": "number (no commas or symbols) or null",
  "loanContingency": "number (days) or null",
  "appraisalContingency": "number (days) or null",
  "inspectionContingency": "number (days) or null",
  "insuranceContingency": "number (days) or null",
  "sellerDocContingency": "number (days) or null",
  "commonInterestContingency": "number (days) or null",
  "leasedLienContingency": "number (days) or null",
  "buyerAgentComp": "number (percentage without symbols) or null"
}
If a value is not found or is blank, return null. For Days, return an integer. For Compensation, look specifically at row G(3).
Raw text:
${fullText}
`;

        // Node 18+ has global fetch built-in
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        if (!response.ok) {
            const errBody = await response.text();
            console.error("Gemini API Error:", errBody);
            throw new Error(`Gemini API Error: ${response.status} ${errBody}`);
        }

        const jsonResp = await response.json();
        
        if (!jsonResp.candidates || !jsonResp.candidates[0] || !jsonResp.candidates[0].content) {
            console.error("Gemini rejected parsing:", JSON.stringify(jsonResp));
            return { success: false, error: "Gemini AI failed to return content. It may have hit a safety filter or failed to parse the document.", raw: jsonResp };
        }

        let extractedJsonStr = jsonResp.candidates[0].content.parts[0].text;
        
        if (extractedJsonStr.startsWith('\`\`\`json')) {
            extractedJsonStr = extractedJsonStr.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '');
        }
        
        const extracted = JSON.parse(extractedJsonStr);
        return { success: true, data: extracted };

    } catch (error) {
        console.error("Extraction error:", error);
        // Return full error details to the client instead of throwing a generic internal error
        return { 
            success: false, 
            error: "Detailed Error",
            message: error.message,
            stack: error.stack,
            stringified: error.toString()
        };
    }
});
