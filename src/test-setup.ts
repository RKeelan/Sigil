import { GlobalRegistrator } from "@happy-dom/global-registrator";

// The unit tests run against a DOM that has no layout: text has no size and nothing is painted.
// What a browser has to be asked is left to the end-to-end tests, which drive the demo page.
GlobalRegistrator.register();

// This DOM reports a change of selection while the selection is being set, where a browser
// reports it afterwards. CodeMirror sets the selection in the middle of an update and can't be
// called back until the update is over, so it is never told.
const listen = document.addEventListener.bind(document);
document.addEventListener = ((type: string, ...rest: unknown[]) => {
  if (type !== "selectionchange")
    (listen as (type: string, ...rest: unknown[]) => void)(type, ...rest);
}) as typeof document.addEventListener;
