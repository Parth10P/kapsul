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
      
      if (!textContent.items || textContent.items.length === 0) {
        continue;
      }

      // Reconstruct lines from text items based on y-coordinates
      const lines = [];
      const sortedItems = [...textContent.items].sort((a, b) => {
        // Sort vertical positions descending (top of page is larger y in PDF coordinates)
        const yDiff = b.transform[5] - a.transform[5];
        if (Math.abs(yDiff) > 5) return yDiff;
        // If vertical position is very close, sort horizontal position ascending (left to right)
        return a.transform[4] - b.transform[4];
      });

      for (const item of sortedItems) {
        if (!item.str || !item.str.trim()) continue;
        const y = item.transform[5];
        const h = item.height || 10;
        // Group items within half font-height vertical tolerance
        const tolerance = Math.max(h * 0.5, 4);

        let foundLine = lines.find(line => Math.abs(line.y - y) < tolerance);
        if (foundLine) {
          foundLine.items.push(item);
        } else {
          lines.push({ y, items: [item] });
        }
      }

      // Sort lines vertically descending to ensure proper top-to-bottom reading
      lines.sort((a, b) => b.y - a.y);

      const lineStrings = [];
      for (const line of lines) {
        // Ensure items within the line are sorted left-to-right
        line.items.sort((a, b) => a.transform[4] - b.transform[4]);
        
        let lineStr = '';
        for (let idx = 0; idx < line.items.length; idx++) {
          const item = line.items[idx];
          if (idx > 0) {
            const prevItem = line.items[idx - 1];
            // Compute gap between end of previous item and start of current item
            const gap = item.transform[4] - (prevItem.transform[4] + prevItem.width);
            // Insert a space if there's a significant visual gap
            if (gap > 3) {
              lineStr += ' ';
            }
          }
          lineStr += item.str;
        }
        lineStrings.push({ text: lineStr.trim(), y: line.y });
      }

      let pageMarkdown = '';
      let inList = false;

      for (let idx = 0; idx < lineStrings.length; idx++) {
        const current = lineStrings[idx];
        const text = current.text;
        if (!text) continue;

        // Detect vertical spacing to classify paragraph breaks
        let spacing = '\n';
        if (idx > 0) {
          const prev = lineStrings[idx - 1];
          const gap = prev.y - current.y;
          if (gap > 18) { // Typical vertical spacing break
            spacing = '\n\n';
          }
        }

        if (isHeading(text)) {
          if (pageMarkdown) pageMarkdown += '\n\n';
          pageMarkdown += `### ${text}\n\n`;
          inList = false;
        } else if (isListItem(text)) {
          if (!inList) {
            spacing = pageMarkdown ? '\n\n' : '';
            inList = true;
          } else {
            spacing = '\n';
          }
          const cleanedList = text.replace(/^[•+*]\s*/, '- ');
          pageMarkdown += (pageMarkdown ? spacing : '') + cleanedList;
        } else {
          if (inList) {
            pageMarkdown += '\n\n';
            inList = false;
          } else {
            pageMarkdown += (pageMarkdown ? spacing : '');
          }
          pageMarkdown += text;
        }
      }

      if (pageMarkdown.trim()) {
        markdownText += `## Page ${i}\n\n${pageMarkdown.trim()}\n\n`;
      }
    }
    
    return markdownText;
  } catch (error) {
    console.error("Error extracting text from PDF:", error);
    throw new Error("Failed to extract PDF text.");
  }
}

/**
 * Basic heuristic to detect section headings.
 */
function isHeading(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return false;
  if (/[.,;:?!]$/.test(trimmed)) return false;
  
  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const isNumberedSection = /^(?:[IVXLCDM]+\.|[0-9]+(?:\.[0-9]+)*\.?)\s+[A-Z]/i.test(trimmed);
  
  return isAllCaps || isNumberedSection;
}

/**
 * Basic heuristic to detect list items.
 */
function isListItem(text) {
  return /^(?:[-*+•]|\d+\.)\s+/.test(text.trim());
}
