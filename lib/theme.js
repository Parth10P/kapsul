// lib/theme.js
// Detect system theme and update the extension's logos accordingly.

function updateLogos(isDark) {
  // 1. Update the popup logo if we are inside the popup
  const popupLogo = document.getElementById("popup-logo");
  if (popupLogo) {
    if (isDark) {
      popupLogo.src = "../icons/icon48_white.png";
    } else {
      popupLogo.src = "../icons/icon48.png";
    }
  }

  // 2. Tell the background script to update the browser toolbar icon
  try {
    chrome.runtime.sendMessage({
      action: "updateThemeIcon",
      isDark: isDark
    });
  } catch (e) {
    // Ignore errors if context is invalid
  }
}

// Check current theme
const darkModeQuery = window.matchMedia('(prefers-color-scheme: dark)');
updateLogos(darkModeQuery.matches);

// Listen for live theme changes
darkModeQuery.addEventListener('change', (e) => {
  updateLogos(e.matches);
});
