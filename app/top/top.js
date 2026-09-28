const toast = document.querySelector('[data-role="toast"]');
let toastTimer = null;

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

document.addEventListener('click', (event) => {
  const comingSoon = event.target.closest('[data-status="soon"]');
  if (!comingSoon) return;
  event.preventDefault();
  showToast(`${comingSoon.dataset.label} は現在準備中です。`);
});
