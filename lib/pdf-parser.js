// Initialize PDF.js worker using the locally bundled script
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');

/**
 * Extracts text from a PDF file and converts it to basic Markdown.
 * @param {File} file - The uploaded PDF File object.
 * @returns {Promise<string>} - The extracted text formatted as Markdown.
 */
async function extractMarkdownFromPDF(file) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    
    // Load the document using the local pdf.js library
    const loadingTask = pdfjsLib.getDocument(new Uint8Array(arrayBuffer));
    const pdf = await loadingTask.promise;
    
    let markdownText = `# Document: ${file.name}\n\n`;
    
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      
      // Basic text extraction, joining items with spaces
      const pageText = textContent.items.map(item => item.str).join(' ');
      
      // Clean up whitespace and add it as a paragraph
      const cleanText = pageText.replace(/\s+/g, ' ').trim();
      
      if (cleanText) {
        markdownText += `## Page ${i}\n\n${cleanText}\n\n`;
      }
    }
    
    return markdownText;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error("Failed to extract PDF text.");
  }
}
