import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); // Using flash for faster analysis

/**
 * Analyzes the content of a file using Gemini.
 * @param {string} content - The file content to analyze.
 * @param {string} prompt - The analysis prompt.
 * @returns {Promise<object>} The analyzed data.
 */
export async function analyzeContent(content, prompt) {
  try {
    logger.info('Analyzing content with Gemini...');
    const result = await model.generateContent([prompt, content]);
    const response = await result.response;
    const text = response.text();

    // Attempt to extract JSON from the response if requested
    try {
      const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/{[\s\S]*}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[1] || jsonMatch[0]);
      }
      return { text };
    } catch (e) {
      logger.warn('Failed to parse JSON from Gemini response, returning raw text.');
      return { text };
    }
  } catch (error) {
    logger.error('Error in Gemini analysis:', error.message);
    throw error;
  }
}
