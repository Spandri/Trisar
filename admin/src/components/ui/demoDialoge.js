// Browser-Dialoge (alert/confirm) halten JavaScript an, bis jemand klickt.
// Waehrend das Demo-Tutorial laeuft (siehe demo/TutorialBridge), wuerde das den
// ganzen Ablauf blockieren. Dort wird deshalb nur protokolliert und bestaetigt;
// ausserhalb des Tutorials bleibt alles beim echten Dialog.

export const tutorialLaeuft = () => typeof window !== 'undefined' && window.__TRISAR_TUTORIAL_LAEUFT === true;

export const demoAlert = (message) => {
  if (tutorialLaeuft()) {
    console.info('[Tutorial] Hinweis ohne Dialog:', message);
    return;
  }
  window.alert(message);
};

export const demoConfirm = (message) => {
  if (tutorialLaeuft()) {
    console.info('[Tutorial] Automatisch bestaetigt:', message);
    return true;
  }
  return window.confirm(message);
};
