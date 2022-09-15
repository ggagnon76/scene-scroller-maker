import { populateMenuButtons } from "./lib/functions.js";
import { Texture2Polygon } from "./lib/poly_from_texture.js";

// Convenience variable to insert the module name where required
export const ModuleName = "scene-scroller-maker";
// Convenience variable to insert the module title where required
export const ModuleTitle = "Scene Scroller Maker"

Hooks.on('getModuleToolGroups', (controlManager, toolGroup) => {
    populateMenuButtons(toolGroup);
});

Hooks.once('ready', () => {
    game.modules.get(ModuleName).api = Texture2Polygon;
})
