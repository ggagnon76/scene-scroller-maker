import { ModuleName, ModuleTitle } from "../ssm-launch.js";

/** A wrapper function that works with the Foundryvtt-devMode module to output debugging info
 *  to the console.log, when a debugging boolean is activated in module settings.
 *  Or the code can pass TRUE to the force argument to output to console.log regardless of the debugging boolean.
 *  @param {Boolean}    force   - A manual bypass to force output regardless of the debugging boolean
 *  @param {}           args    - The content to be output to console.log
 *  @return {void}
 */
 export function log(force, content) {
    try {
        const isDebugging = game.modules.get('_dev-mode')?.api?.getPackageDebugValue(ModuleName);

        if ( isDebugging ) {
            console.log(ModuleTitle,  " debugging | ", content);
        } else if ( force ) {
            console.log(ModuleTitle, " | ", content)
        }
    } catch (e) {}
}

/** This function populates the menu buttons.  See getModuleToolGroups hook.
 *  @param {Object}     - toolGroup
 *  @return {void}
 */
export function populateMenuButtons(toolGroup) {
    toolGroup.push({
        name: "tile-nudge",
        icon: "<i class='fas fa-arrows-alt'></i>",
        title: "Nudge Tiles by 1px",
        button: true,
        tools:  [{
                    name: "nudge-up",
                    title: "Nudge Tile UP by 1px",
                    icon: "<i class='fas fa-arrow-up'></i>",
                    onClick: nudgeTileUP,
                    button: true
                },
                {
                    name: "nudge-left",
                    title: "Nudge Tile LEFT by 1px",
                    icon: "<i class='fas fa-arrow-left'></i>",
                    onClick: nudgeTileLEFT,
                    button: true
                },
                {
                    name: "nudge-right",
                    title: "Nudge Tile RIGHT by 1px",
                    icon: "<i class='fas fa-arrow-right'></i>",
                    onClick: nudgeTileRIGHT,
                    button: true
                },
                {
                    name: "nudge-down",
                    title: "Nudge Tile DOWN by 1px",
                    icon: "<i class='fas fa-arrow-down'></i>",
                    onClick: nudgeTileDOWN,
                    button: true
                }]
    },
    {
        name: "create-links",
        title: "Create links in flags.",
        icon: "<i class='fas fa-link'></i>",
        button: true,
        onClick: linkScenes
    })
}

/** Returns a compendium scene document when given a pack name and scene name
 * @param {string}  pack    - The name of the compendium pack
 * @param {string}  scene   - The name of the scene in the above compendium pack
 * @returns {object}        - SceneDocument?
 */
 export async function getSource(pack, scene) {
    const compndm = game.packs.filter(p => p.title === pack)[0];
    const clctn = compndm.collection;
    const scn_id = compndm.index.getName(scene)._id;
    const uuid = `Compendium.${clctn}.${scn_id}`;
    const source = await fromUuid(uuid);
    return source;
}

const debouncedTileTranslation = foundry.utils.debounce((updates) => {
    canvas.scene.updateEmbeddedDocuments("Tile", updates);
    log(false, "updateEmbeddedDocuments for Tile translation submitted to server.");
}, 3000);

/** A function to move selected tiles by a vector, per button press.
 *  Debounces the final update by 3 seconds to not spam the server.
 *  @param {object}     vector      - An object vector to represent the translation, ex: {x: 100, y: -200}  ie:100 right, 200 up
 *  @returns {void}
 */
function nudge(vector) {
    const tiles = canvas.background.controlled;
    if (!tiles.length) return
    const updates = [];
    for (const tile of tiles) {
        tile.position.set(tile.position._x + vector.x, tile.position._y + vector.y);
        const updateObj = {
            _id: tile.id,
            x: tile.position._x,
            y: tile.position._y
        }
        updates.push(updateObj);
    }
    debouncedTileTranslation(updates);
}

/** Invokes the nudge function, and sets the vector to +1 in y direction (down) 
 *  @returns {void}
*/
function nudgeTileDOWN() {
    nudge({x: 0, y: 1});
}

/** Invokes the nudge function, and sets the vector to -1 in x direction (left) 
 *  @returns {void}
*/
function nudgeTileLEFT() {
    nudge({x: -1, y: 0});
}

/** Invokes the nudge function, and sets the vector to +1 in x direction (right) 
 *  @returns {void}
*/
function nudgeTileRIGHT() {
    nudge({x: 1, y: 0});
}

/** Invokes the nudge function, and sets the vector to -1 in y direction (up) 
 *  @returns {void}
*/
function nudgeTileUP() {
    nudge({x: 0, y: -1});
}

async function linkScenes() {
    const tiles = canvas.background.controlled;
    if (tiles.length !== 2) {
        ui.notifications.error("Two tiles must be selected.")
        return;
    }

    for (const tile of tiles) {
        const tileUUID = tile.document.getFlag("scene-tiler", "scene");
        const tileSource = await fromUuid(tileUUID);
        let sceneFlagData = {};
        if (tileSource.data.flags.hasOwnProperty(ModuleName)) {
            sceneFlagData = tileSource.getFlag(ModuleName, "sceneScrollerTilerFlags");
        } else {
            sceneFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTilerFlags);
        }
        const sceneTileLinks = foundry.utils.deepClone(game.modules.get("scene-scroller").api.sceneScrollerTileLinks);
        const tile1 = tile.id === tiles[0].id ? tiles[0] : tiles[1];
        const tile2 = tile.id === tiles[0].id ? tiles[1] : tiles[0];

        sceneTileLinks.SceneUUID = tile2.document.getFlag("scene-tiler", "scene");
        sceneTileLinks.Vector = {x: tile1.data.x - tile2.data.x, y: tile1.data.y - tile2.data.y};

        const isExists = sceneFlagData.LinkedTiles.filter(d => d.SceneUUID === tileUUID);
        if (isExists.length) {
            const index = sceneFlagData.LinkedTiles.indexOf(isExists[0]);
            if (index !== -1) {
                sceneFlagData.LinkedTiles[index] = sceneTileLinks;
            }
        } else sceneFlagData.LinkedTiles.push(sceneTileLinks)

        await tileSource.setFlag(ModuleName, "sceneScrollerTilerFlags", sceneFlagData);
    }
    ui.notifications.info("Links saved to scenes flags.")
}