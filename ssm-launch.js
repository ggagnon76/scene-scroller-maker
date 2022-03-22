import { populateMenuButtons } from "./lib/functions.js";
import { Texture2Polygon } from "./lib/poly_from_texture.js";

// Convenience variable to insert the module name where required
export const ModuleName = "scene-scroller-maker";
// Convenience variable to insert the module title where required
export const ModuleTitle = "Scene Scroller Maker"

// This works with the Foundryvtt-devMode module to create debug settings that persist across refreshes.
// If used properly, debug logging (see log() function) will not be released to users.
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(ModuleName);
});

Hooks.on('getModuleToolGroups', (controlManager, toolGroup) => {
    populateMenuButtons(toolGroup);
});

Hooks.once('ready', () => {
    game.modules.get(ModuleName).api = Texture2Polygon;
})