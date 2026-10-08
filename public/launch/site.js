const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');

if (menuButton && navigation) {
  document.documentElement.classList.add('js-ready');

  function setMenuOpen(open) {
    menuButton.setAttribute('aria-expanded', String(open));
    menuButton.setAttribute(
      'aria-label',
      open ? 'Close navigation' : 'Open navigation'
    );
    navigation.dataset.open = String(open);
    if (open) {
      navigation.querySelector('a')?.focus();
    } else if (navigation.contains(document.activeElement)) {
      menuButton.focus();
    }
  }

  menuButton.addEventListener('click', () => {
    setMenuOpen(menuButton.getAttribute('aria-expanded') !== 'true');
  });

  navigation.addEventListener('click', event => {
    if (event.target instanceof Element && event.target.closest('a')) {
      setMenuOpen(false);
    }
  });

  document.addEventListener('keydown', event => {
    if (
      event.key === 'Escape' &&
      menuButton.getAttribute('aria-expanded') === 'true'
    ) {
      setMenuOpen(false);
      menuButton.focus();
    }
  });
}

const recordDemoButton = document.querySelector('[data-record-demo]');
const captureCard = document.querySelector('[data-capture-card]');
const captureTimer = document.querySelector('[data-record-timer]');
const captureLabel = document.querySelector('[data-record-label]');
const captureStatus = document.querySelector('[data-capture-status]');

if (
  recordDemoButton &&
  captureCard &&
  captureTimer &&
  captureLabel &&
  captureStatus
) {
  let elapsedSeconds = 18;
  let timerId = null;

  function formatTimer(seconds) {
    const minutes = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const remainder = (seconds % 60).toString().padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function setCaptureState(recording) {
    captureCard.dataset.state = recording ? 'recording' : 'ready';
    recordDemoButton.setAttribute('aria-pressed', String(recording));
    recordDemoButton.setAttribute(
      'aria-label',
      recording ? 'Stop recording demo' : 'Play recording demo'
    );
    captureLabel.textContent = recording ? 'Stop demo' : 'Record';
    captureStatus.textContent = recording ? 'Recording' : 'Ready';
    captureTimer.textContent = formatTimer(elapsedSeconds);

    if (recording) {
      timerId = window.setInterval(() => {
        elapsedSeconds += 1;
        captureTimer.textContent = formatTimer(elapsedSeconds);
      }, 1000);
    } else if (timerId !== null) {
      window.clearInterval(timerId);
      timerId = null;
    }
  }

  recordDemoButton.addEventListener('click', () => {
    setCaptureState(recordDemoButton.getAttribute('aria-pressed') !== 'true');
  });

  window.addEventListener('pagehide', () => {
    if (timerId !== null) window.clearInterval(timerId);
  });
}
