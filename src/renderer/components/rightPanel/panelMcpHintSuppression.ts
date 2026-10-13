type HintSuppressed = boolean | null;

let suppressed: HintSuppressed = null;
let initialized = false;
const listeners = new Set<() => void>();

const notify = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

const apply = (next: boolean): void => {
  if (next === suppressed) {
    return;
  }
  suppressed = next;
  notify();
};

const ensureInitialized = (): void => {
  if (initialized) {
    return;
  }
  initialized = true;
  void window.snow
    .getPanelMcpHintSuppressed()
    .then(apply)
    .catch(() => {
      apply(false);
    });
  window.snow.onPanelMcpHintSuppressedChanged(apply);
};

export const isPanelMcpHintReady = (): boolean => {
  ensureInitialized();
  return suppressed !== null;
};

export const isPanelMcpHintSuppressed = (): boolean => {
  ensureInitialized();
  return suppressed === true;
};

export const suppressPanelMcpHint = (): void => {
  apply(true);
  window.snow.setPanelMcpHintSuppressed(true);
};

export const subscribePanelMcpHintSuppression = (
  listener: () => void,
): (() => void) => {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
