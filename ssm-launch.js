import {    hasDependencies,
            populateMenuButtons
         } from "./lib/functions.js";

// Convenience variable to insert the module name where required
export const ModuleName = "scene-scroller-maker";
// Convenience variable to insert the module title where required
export const ModuleTitle = "Scene Scroller Maker"

const dependencies = ["scene-scroller", "lib-df-buttons"];

let isReady = false;

// This works with the Foundryvtt-devMode module to create debug settings that persist across refreshes.
// If used properly, debug logging (see log() function) will not be released to users.
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(ModuleName);
});

/** Hook once on 'READY' to initialize the following:
 *   - Check all dependencies are installed and activated.  Then set isReady to TRUE.
 */
 Hooks.once('ready', () => {
    if ( !hasDependencies(dependencies) ) return;
    isReady = true;
})

Hooks.on('getModuleToolGroups', (controlManager, toolGroup) => {
    populateMenuButtons(toolGroup);
});