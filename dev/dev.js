import { ModuleName } from "../ssm-launch.js";
import { isColliding, getSceneBoundsAsClipper, clipperIntersection } from "../lib/functions.js";

/** Form application that will be invoked when a user wants to link a scene to another.
 *  The form will request the user choose a compendium and then the scene.
 */
 export class PickScene extends FormApplication {
    constructor(resolve, template = "initialize.hbs") {
      super();
      
      this.options.template = template === "initialize.hbs" ? this.options.template : `./modules/${ModuleName}/templates/${template}`;
      this.options.title = template === "initialize.hbs" ? this.options.title : game.i18n.localize('SSM.PickSceneUI.Title2');
      this.compendiumList = game.packs
                            .filter(p => p.documentName === "Scene")
                            .map(p => {return p.title});
      this.compendiumChoice = null;
      this.sceneList = [];
      this.callback = (result) => resolve(result);
  
      Handlebars.registerHelper('comp_equal', function(picked) {
        return this === picked;
      })
    }
  
    close(options={}) {
      if ( !options.resolved ) this.callback(null)
      return super.close(options);
    }
  
    static get defaultOptions() {
      return mergeObject(super.defaultOptions, {
        width: 400,
        template: `./modules/${ModuleName}/templates/initialize.hbs`,
        id: "scene-scroller-maker-pick-form",
        title: game.i18n.localize('SSM.PickSceneUI.Title1'),
        submitOnChange: true,
        closeOnSubmit: false
      })
    }
  
    getData() {
      // Send compendium choice and list of scenes to the template
      if (this.compendiumChoice !== null) {
        // List of scenes in selected compendium for selection box
        this.sceneList = [];
        const compndm = game.packs.filter(p => p.title === this.compendiumChoice)[0];
        for (const scn of compndm.index.contents) {
          this.sceneList.push(scn.name);
        }
      }
  
      // Send list of scene compendiums to the template
      return {
        compSelectText: game.i18n.localize('SSM.InitiateSceneUI.Instructions.SelectCompendium'),
        defaultSelect: game.i18n.localize('SSM.InitiateSceneUI.SelectDefault'),
        sceneSelectText: game.i18n.localize('SSM.InitiateSceneUI.Instructions.SelectScene'),
        compendiumList: this.compendiumList,
        compendium: this.compendiumChoice,
        sceneList: this.sceneList
      }
    }
  
    activateListeners(html) {
      super.activateListeners(html);
    }
  
    _updateObject(event, formData) {
      if (!formData.z_scene_sel || formData.z_scene_sel === "no_selection") {
        if (formData.z_comp_sel === "no_selection") return
        this.compendiumChoice = formData.z_comp_sel;
        this.render(true);
        return;
      }
      if (formData.z_scene_sel) {
        const sourceUUID = getUUID(formData.z_comp_sel, formData.z_scene_sel);
        Handlebars.unregisterHelper('comp_equal');
        this.callback(sourceUUID);
        this.close({resolved: true});
      }
    }
  }

/**
 * Function that calculates the coordinates for a new point that is a distance perpendicular to an
 * existing point on the line.
 * (Used to create link sprites on screen)
 * @param {number} slope    The slope of the line
 * @param {object} point    Object containing coordinates of a point, ie: {x: <number>, y: <number>}
 * @param {number} distance Distance of the new point from the existing line.
 * @returns {object}        {x: <number>, y: <number>}
 */
function offsetPointFromSlope(slope, point, distance) {
    const perpSlope = 1 / slope * -1;
    const r = Math.sqrt(1 + perpSlope * perpSlope);     // Unit vector along perpSlope
    let offsetPoint = {
        x: point.x + (distance / r),
        y: point.y + ((distance * perpSlope) / r)
    }
    offsetPoint.x = (Math.floor(offsetPoint.x) === point.x) ? Math.ceil(offsetPoint.x) : Math.floor(offsetPoint.x);
    offsetPoint.y = (Math.floor(offsetPoint.y) === point.y) ? Math.ceil(offsetPoint.y) : Math.floor(offsetPoint.y);
    return {x: offsetPoint.x, y: offsetPoint.y}
}

/**
     * Creates a visual representation on the canvas to visually show which sub-scenes
     * will have links to adjacent sub-scenes.  Implements a click handler to be able to
     * delete unwanted links.
     * @param {array} coord     // Foundry wall coordinates, array: [x1, y1, x2, y2]
     * @param {object} center   // {x: <number>, y: <number>}
     * @returns 
     */
export function _createLinkGraphic(coord, center, divID, divisionID){
        
    const d = 50; // pixels perpendicular

    const wallSlope = slope([coord[0], coord[1]], [coord[2], coord[3]]);
    let p1, p2;
    if ( wallSlope === 0 ) {
        // Horizontal
        p1 = {x: center.x, y: center.y + d};
        p2 = {x: center.x, y: center.y - d};
    } else if ( isFinite(wallSlope) ) {
        p1 = offsetPointFromSlope(wallSlope, center, d);
        p2 = offsetPointFromSlope(wallSlope, center, -d);
    } else {
        // Vertical
        p1 = {x: center.x + d, y: center.y};
        p2 = {x: center.x - d, y: center.y};
    }
    const link = new PIXI.LegacyGraphics();
    link.beginFill(0x000000);
    link.drawCircle(p1.x, p1.y, 30);
    link.drawCircle(p2.x, p2.y, 30);
    link.moveTo(p1.x, p1.y);
    link.lineStyle(25, 0x000000);
    link.lineTo(p2.x, p2.y);
    link.beginFill(0xff6400);
    link.lineStyle(10, 0xff6400);
    link.lineTo(p1.x, p1.y);
    link.drawCircle(p1.x, p1.y, 10);
    link.drawCircle(p2.x, p2.y, 10);
    link.endFill();
    link.interactive = true;
    link.on('click', this.deleteLink);
    link.divID = [divID, divisionID];

    this.linkContainer.addChild(link);

    return link;
}

export function deleteDivLinks(divID) {
    const div = this.divisions.filter(d => d.drawingID === divID);
    for (const link of this.links) {
        const hasDiv = link[1].divs.filter(d => d.drawingID === divID);
        if ( hasDiv.length ) {
            this.links.delete(link[0]);
            const linkGraphic = this.linkContainer.children.filter(c => c.divID.includes(divID))[0];
            this.linkContainer.removeChild(linkGraphic);
            linkGraphic.destroy(true);
        }
    }
}

export function _deleteLink(event) {
    for (const [key, value] of this.links) {
        if ( value.link === event.currentTarget ) this.links.delete(key)
    }
    this.linkContainer.removeChild(event.currentTarget);
    event.currentTarget.destroy(true);
}

export async function _embedLinkFlags(pack) {
    if ( !game.modules.get("scene-scroller").active ) {
        ui.notifications.info(game.i18n.localize('SSM.SceneDividerUI.SceneScrollerNoFlags'));
        return;
    }
    if ( !this.links.size ) return;
    const subSceneFlagKeys = Object.keys(game.modules.get("scene-scroller").struct.compendiumSceneFlags);
    const subSceneChildrenKeys = Object.keys(game.modules.get("scene-scroller").struct.subSceneChildrenFlags);

    /* Step 1: Begin by iterating all the links to save data in sub-scene flags */
    const clctn = pack.collection;
    for (const [id, link] of this.links) {
        for (const div of link.divs) {
            const otherDiv = div === link.divs[0] ? link.divs[1] : link.divs[0];
            const scn_id = pack.index.getName(div.subSceneName)._id;
            const uuid = `Compendium.${clctn}.${scn_id}`;
            const subScene = await fromUuid(uuid);
            let subSceneChildrenFlagData = foundry.utils.deepClone(game.modules.get("scene-scroller").struct.compendiumSceneFlags[subSceneFlagKeys[0]]);
            if ( subScene.flags.hasOwnProperty(ModuleName) ) {
                subSceneChildrenFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);
            }
            const otherScnID = pack.index.getName(otherDiv.subSceneName)._id;
            const otherUUID = `Compendium.${clctn}.${otherScnID}`;
            // Second key temporarily holds div name, to make it easier to find div in next step.
            subSceneChildrenFlagData.push({
                [subSceneChildrenKeys[0]]: otherUUID,
                [subSceneChildrenKeys[1]]: otherDiv.subSceneName
            });
            await subScene.setFlag(ModuleName, subSceneFlagKeys[0], subSceneChildrenFlagData);
        }
    }

    /* Step 2: Iterate every sub-scene to calculate the size (bounds) of the scene needed to hold the sub-scene and child sub-scenes */
    for (const div of this.divisions) {
        let minX = div.boundingBox.sceneX;
        let minY = div.boundingBox.sceneY;
        let maxX = div.boundingBox.sceneX + div.boundingBox.width;
        let maxY = div.boundingBox.sceneY + div.boundingBox.height;

        const scn_id = pack.index.getName(div.subSceneName)._id;
        const uuid = `Compendium.${clctn}.${scn_id}`;
        const subScene = await fromUuid(uuid);
        let subSceneFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);

        for (const data of subSceneFlagData) {
            for (const division of this.divisions) {
                if ( division.subSceneName !== data[subSceneChildrenKeys[1]] ) continue;
                minX = minX < division.boundingBox.sceneX ? minX : division.boundingBox.sceneX;
                minY = minY < division.boundingBox.sceneY ? minY : division.boundingBox.sceneY;
                maxX = maxX > (division.boundingBox.sceneX + division.boundingBox.width) ? maxX : division.boundingBox.sceneX + division.boundingBox.width;
                maxY = maxY > (division.boundingBox.sceneY + division.boundingBox.height) ? maxY : division.boundingBox.sceneY + division.boundingBox.height;
                break;
            }
        }
        
        /* Calculate sub-scene coordinates relative to minX & minY and save them in flags */

        // Bounds for the parent sub-scene
        const bounds = {
            minX: minX,
            minY: minY,
            width: maxX - minX,
            height: maxY - minY
        }
        await subScene.setFlag(ModuleName, subSceneFlagKeys[1], bounds);

        // Coords for the parent sub-scene
        const coords = {
            x: div.boundingBox.sceneX - minX,
            y: div.boundingBox.sceneY - minY,
        }
        await subScene.setFlag(ModuleName, subSceneFlagKeys[2], coords);

        // Polygons for the parent sub-scene
        await subScene.setFlag(ModuleName, subSceneFlagKeys[3], div.boundingBox.polygon)
    }

    // Coords for all the children sub-scenes
    for (const div of this.divisions) {
        const scn_id = pack.index.getName(div.subSceneName)._id;
        const uuid = `Compendium.${clctn}.${scn_id}`;
        const subScene = await fromUuid(uuid);

        // Get an array of children
        let subSceneFlagData = subScene.getFlag(ModuleName, subSceneFlagKeys[0]);
        // Get the bounds for the parent
        const parentBounds = subScene.getFlag(ModuleName, subSceneFlagKeys[1]);
        for (const data of subSceneFlagData) {
            for (const division of this.divisions) {
                if ( division.subSceneName !== data[subSceneChildrenKeys[1]] ) continue;
                data[subSceneChildrenKeys[1]] = {
                    x: division.boundingBox.sceneX - parentBounds.minX,
                    y: division.boundingBox.sceneY - parentBounds.minY,
                    width: division.boundingBox.width,
                    height: division.boundingBox.height
                }
                break;
            }
        }
        await subScene.setFlag(ModuleName, subSceneFlagKeys[0], subSceneFlagData);
    }
}

/**
     * Examines walls between scenes to determine if it is possible for things
     * that can be sensed (sound, light) to transfer between scenes.  Also looks
     * for allowed movement such as ethereal walls or doors.
     * Creates a data object(used later), and a visual representation on the canvas
     * that can be clicked to be deleted.
     * @param {object} div Instance of Texture2Polygon
     */
export function _createLinks(div) {

    this.deleteLink = _deleteLink.bind(this);
    this.createLinkGraphic = _createLinkGraphic.bind(this);

    if( this.divisions.length < 2 ) return;
    // Start iterating over previous divisions
    next_division:
    for (const division of this.divisions) {
        
        // If div and division are the same, skip to next.
        if ( div === division) continue;

        // If there is a pre-existing link already, skip to next.
        const linkID = div.drawingID.slice(8) + division.drawingID.slice(-8)
        if ( this.links.has(linkID) ) continue;

        // Check to see if these divisions even have a common edge.  If not, skip to next.
        if ( !isColliding(div.clipperPathFinal, division.clipperPathFinal) ) continue;
        
        // Check to see if these two divisions have a common wall that also allows vision or movement.
        // If yes, create a link and then skip to next.
        for (const wall of div.wallsInDiv) {
            if ( 
                wall.document.light === 20 &&
                wall.document.move === 20 &&
                wall.document.sight === 20 &&
                wall.document.sound === 20 &&
                wall.document.door === 0
            ) continue;
            
            for (const w of division.wallsInDiv) {
                if ( wall.id !== w.id ) continue;
                const link = this.createLinkGraphic(wall.coords, wall.center, div.drawingID, division.drawingID);
                const linkObj = {
                    link: link,
                    divs: [div, division]
                }
                this.links.set(linkID, linkObj);
                continue next_division;
            }
        }

        // Shares an edge but doesn't have any walls that allow vision or movement.
        // Find adjacent edges that don't have walls.

        function polyCoordSlope(polygonPath) {
            const coordSlopes = new Set();
            for (let i=0; i < polygonPath.length; i++) {
                const j = i === polygonPath.length - 1 ? 0 : i + 1;
                const obj = {
                    x: polygonPath[i].X,
                    y: polygonPath[i].Y,
                    slope: slope([polygonPath[i].X, polygonPath[i].Y], 
                        [polygonPath[j].X, polygonPath[j].Y]).toString()
                }

                coordSlopes.add(JSON.stringify(obj));
            }
            return coordSlopes
        }

        function wallCoordSlope(wallArray) {
            const coordSlopes = new Set();
            for (const wall of wallArray) {
                const doc = wall.document
                // Wall and slope from one end
                const obj1 = {
                    x: doc.c[0],
                    y: doc.c[1],
                    slope: slope([doc.c[0], doc.c[1]], [doc.c[2], doc.c[3]]).toString()
                }
                // Wall and slope from other end
                const obj2 = {
                    x: doc.c[2],
                    y: doc.c[3],
                    slope: slope([doc.c[2], doc.c[3]], [doc.c[0], doc.c[1]]).toString()
                }
                coordSlopes.add(JSON.stringify(obj1));
                coordSlopes.add(JSON.stringify(obj2));
            }

            return coordSlopes
        }

        // UnionedSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of the two divisions after being unioned.
        const unioned = clipperIntersection(getSceneBoundsAsClipper(), [div.clipperPathFinal, division.clipperPathFinal])
        const unionedSlopes = polyCoordSlope(unioned);

        // divSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of div.
        const divSlopes = polyCoordSlope(div.clipperPathFinal);

        // divisionSlopes is a SET containing coordinate + slope pairs for every point around the perimeter of division.
        const divisionSlopes = polyCoordSlope(division.clipperPathFinal);

        // coordSlopes is a combined SET containing coordinate + slope pairs for every point around the perimeter of div and division.
        const coordSlopes = new Set([...divSlopes, ...divisionSlopes]);

        // remove all perimeter points from coordSlopes
        let innerCoordSlopes = [...coordSlopes].filter(coord => ![...unionedSlopes].includes(coord));

        // Produce coordinates + slopes for each end of each wall.
        const wallsInDiv = [];
        const allWallsData = canvas.walls.placeables;
        for (const wall of allWallsData) {
            const pt1 = new ClipperLib.IntPoint(wall.document.c[0], wall.document.c[1]);
            const pt2 = new ClipperLib.IntPoint(wall.document.c[2], wall.document.c[3]);
            if (    ClipperLib.Clipper.PointInPolygon(pt1, unioned) === 0 &&
                    ClipperLib.Clipper.PointInPolygon(pt2, unioned) === 0 ) continue;

            wallsInDiv.push(wall);                            
        }

        const divWallSlopes = wallCoordSlope(wallsInDiv);

        // Remove all points that correspond to a wall.
        innerCoordSlopes = innerCoordSlopes.filter(coord => ![...divWallSlopes].includes(coord));

        // If there's nothing left, just continue to next div.
        if ( !innerCoordSlopes.length ) continue next_division;

        // Clean up the remaining points, sorting by slope.  Not full proof.  If by chance the same slope is produced in two places, this blows up.
        innerCoordSlopes = innerCoordSlopes.map(coord => JSON.parse(coord));

        function sortBySlope(coordObj) {
            if ( sortedInnerCoords.has(coordObj.slope) ) {
                const coord = sortedInnerCoords.get(coordObj.slope);
                coord.x2 = coordObj.x;
                coord.y2 = coordObj.y;
                sortedInnerCoords.set(coordObj.slope, coord);
            } else {
                sortedInnerCoords.set(coordObj.slope, {
                    x1: coordObj.x,
                    y1: coordObj.y,
                    x2: undefined,
                    y2: undefined
                })
            }
        }

        const sortedInnerCoords = new Map();
        innerCoordSlopes.forEach(coord => sortBySlope(coord));

        const wallCoords = [] 
        for (const coord of (sortedInnerCoords.values())) {
            wallCoords.push(coord.x1, coord.y1, coord.x2, coord.y2);
        }

        const midpoint = {
            x: (wallCoords[0] + wallCoords[2]) / 2,
            y: (wallCoords[1] + wallCoords[3]) / 2
        }
        const link = this.createLinkGraphic(wallCoords, midpoint, div.drawingID, division.drawingID);
        const linkObj = {
            link: link,
            divs: [div, division]
        }
        this.links.set(linkID, linkObj);
    }
}

/** Returns the UUID for a compendium scene document when given a pack name and scene name
 * @param {string}  pack    - The name of the compendium pack
 * @param {string}  scene   - The name of the scene in the above compendium pack
 * @returns {string}        - the UUID
 * 
 */
async function getUUID(pack, scene) {
    log(false, "Executing 'getSource' function.");
    const compndm = game.packs.filter(p => p.title === pack)[0];
    const clctn = compndm.collection;
    const scn_id = compndm.index.getName(scene)._id;
    return `Compendium.${clctn}.${scn_id}`;
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
        // Have to do the following so the tile doesn't jitter when clicking elsewhere in the scene.
        tile.data.x = tile.data._source.x += vector.x;
        tile.data.y = tile.data._source.y += vector.y;
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

/** Insert data into source flags to be used the Scene Scroller module.*/
export async function linkScenes() {
    if ( !game.user.isGM ) return;

    // Get the scene to add to
    const sourceUUID = await new Promise((resolve) => {
        new PickScene(resolve, "initialize.hbs").render(true);
    })

    const source = await fromUuid(sourceUUID);

    if ( source === null ) {
        ui.notification.error(game.i18n.localize("SSM.PickSceneUI.Error1"));
        return;
    }

    // The temporary scene that will be created needs to know the size, with a buffer all around so
    // the added sub-scene can be dragged and positioned around the existing scene.
    const sceneSize = source.getFlag(ModuleName, "Bounds");
    const buffer = getBuffer(sceneSize);

    // Create a new temporary scene
    const oldScene = canvas.scene || null;
    const newSceneData = {
        height: sceneSize.height + 2 * buffer.height,
        width: sceneSize.width + 2 * buffer.width,
        name: "SSM Link - Temporary Scene",
        active: true,
        padding: 0
    }
    const scene = await Scene.create(newSceneData);

    // Create the background using the source sub-scene and the children sub-scenes.
    // The background images are local memory only tiles without event handlers (can't be selected).
    const uuidArray = [sourceUUID];
    const childrenArray = source.getFlag(ModuleName, "SubSceneChildren");
    for (const child of childrenArray) {
        uuidArray.push(child.ChildrenSceneUUIDs);
    }
    await createBackgroundTiles(uuidArray, source, buffer, scene);
    
    // Now prompt the user again to select the sub-scene to link
    const linkSourceUUID = await new Promise((resolve) => {
        new PickScene(resolve, "initialize.hbs").render(true);
    })

    const linkSource = await fromUuid(linkSourceUUID);

    if ( linkSource === null ) {
        ui.notification.error(game.i18n.localize("SSM.PickSceneUI.Error1"));
        return;
    }

    // TO-DO: Create a real Tile.  But remove resize handlers.
    const linkTileData = {
        height: linkSource.height,
        width: linkSource.width,
        img: linkSource.background.src,
        overhead: false,
        type: "Tile",
        x: 0,
        y: 0
    }
    const linkTileCreate = await scene.createEmbeddedDocuments("Tile", [linkTileData]);
    const linkTile = linkTileCreate[0].object;

    // Make Tile Controls active and prevent resizing.
    await wait(1000);
    const _linkDragLeftStart = (event) => {
        linkTile._dragHandle = false;
        return linkTile._onDragLeftStart.apply(linkTile, [event]);
    };
    linkTile.mouseInteractionManager.callbacks.dragLeftStart = _linkDragLeftStart;
    
    canvas["tiles"].activate();

    // pre-control the new tile
    await linkTile.control({releaseOthers: true});

    // Then spawn a prompt dialog.
    const promptDialogData = {
        title: game.i18n.localize("SSM.LinkScenesUI.Title"),
        content: game.i18n.localize("SSM.LinkScenesUI.Content"),
        label: game.i18n.localize("SSM.LinkScenesUI.Label"),
        callback: () => {return true}
    }
    await Dialog.prompt(promptDialogData);

    // Need to feed a coordinate for the new tile relative to the top left corner of the source tile.
    const coordData = source.getFlag(ModuleName, "Coords");
    const coord = {x: linkTile.x - (coordData.x  + buffer.width), y: linkTile.y - (coordData.y + buffer.height)};
    await addChildSubScene(source, linkSource, linkSourceUUID, coord);

    const twoWay = await confirmDialog(
        game.i18n.localize("SSM.LinkScenesUI.ConfirmTitle"),
        game.i18n.localize("SSM.LinkScenesUI.ConfirmContent")
        );
    
    if ( twoWay ) {
        // Provide a coordinate for source relative to new tile.
        const twoWayCoord = {x: (coordData.x + buffer.width) - linkTile.x, y: (coordData.y + buffer.height) - linkTile.y};
        await addChildSubScene(linkSource, source, sourceUUID, twoWayCoord);
    }

    // Delete the temporary scene and return to the original scene.
    if ( oldScene !== null ) await oldScene.update({active: true});
    await wait(1000);
    await scene.delete();
}

/**
 * A confirmation dialog mostly used when debugging is turned on.
 * @param {string} title
 * @param {string} content
 * @returns {promise}
 */
export async function confirmDialog(title, content) {
    return await Dialog.confirm({
        title: title,
        content: content,
        yes: () => {return true},
        no: () => {return false}
    })
}

export async function displayPoints(points, size) {
    const container = new PIXI.Container();
    for ( let i = 0; i < points.length; i+=2) {
        const dot = new PIXI.LegacyGraphics();
        dot.beginFill("0xFF0000");
        dot.drawCircle(points[i], points[i+1], size);
        dot.endFill();
        container.addChild(dot);
    }

    canvas.stage.addChild(container);

    const title = "Ellipse vertices verification";
    const content = "Points should be on ellipse perimeter.";
    await confirmDialog(title, content);

    canvas.stage.removeChild(container);
    container.destroy(true);
}

function getBuffer(bounds) {
    const d = canvas.dimensions;
    const widthInSquares = bounds.width / d.size;
    const heightInSquares = bounds.height / d.size;

    return {
        width: Math.ceil(widthInSquares * 0.25) * d.size,
        height: Math.ceil(heightInSquares * 0.25) * d.size
    }
}

async function createBackgroundTiles(uuids, source, buffer, scene) {
    if ( !Array.isArray(uuids) ) uuids = [uuids];

    for (const uuid of uuids) {
        const newSource = await fromUuid(uuid);
        const coord = {};
        if ( source === newSource) {
            coord.x = source.getFlag(ModuleName, "Coords").x + buffer.width,
            coord.y = source.getFlag(ModuleName, "Coords").y + buffer.height,
            coord.width = source.width,
            coord.height = source.height,
            coord.src = source.background.src;
        } else {
            const sourceData = source.getFlag(ModuleName, "SubSceneChildren").filter(child => child.ChildrenSceneUUIDs === uuid).pop();
            coord.x = sourceData.ChildCoords.x + buffer.width;
            coord.y = sourceData.ChildCoords.y + buffer.height;
            coord.width = newSource.width,
            coord.height = newSource.height,
            coord.src = newSource.background.src;
        }

        const texSprite = new PIXI.Sprite(await loadTexture(coord.src));

        // This is not saved to database.  Local memory only.
        const data = {
            x: 0,
            y: 0,
            width: coord.width,
            height: coord.height,
            overhead: false,
            img: coord.src,
            _id: foundry.utils.randomID(16)
        }
        const tileDoc = new TileDocument(data, {parent: scene});
        const tile = tileDoc.object;
        tile.x = tile.document.x = coord.x;
        tile.y = tile.document.y = coord.y;
        initializeTile(tile, texSprite);
    }
}

function initializeTile(tile, sprite) {
    tile.texture = sprite.texture;
    tile.tile = tile.addChild(sprite);
    tile.tile.anchor.set(0.5,0.5);

    tile.tile.scale.x = tile.width / tile.texture.width;
    tile.tile.scale.y = tile.height / tile.texture.height;
    tile.tile.position.set(Math.abs(tile.width)/2, Math.abs(tile.height)/2);
    tile.tile.rotation = Math.toRadians(tile.rotation);
}

async function addChildSubScene(source, child, childUUID, relCoord) {

    // Extrapolate the coordinate relative to 0,0 for the child
    const bounds = source.getFlag(ModuleName, "Bounds");
    const coords = source.getFlag(ModuleName, "Coords");
    const coord = {
        x: coords.x + relCoord.x,
        y: coords.y + relCoord.y
    }

    // Extract existing data stored in flags

    const subSceneChildren = source.getFlag(ModuleName, "SubSceneChildren");

    // Start collecting data to determine the new scene size.
    const xArr = [coord.x, coord.x + child.width - 2 * polygonOffsetByPixels];
    const yArr = [coord.y, coord.y + child.height - 2 * polygonOffsetByPixels];
    for (const childData of subSceneChildren) {
        const tile = childData.ChildCoords;
        xArr.push(tile.x, tile.x + tile.width);
        yArr.push(tile.y, tile.y + tile.height);
    }

    const minX = Math.min(...xArr);
    const minY = Math.min(...yArr);
    const maxX = Math.max(...xArr);
    const maxY = Math.max(...yArr);
    const width = maxX - minX;
    const height = maxY - minY;

    // Update flag data
    // Adding a sub-scene to an existing scene, the width and height should never be smaller.
    bounds.width = bounds.width > width ? bounds.width : width;
    bounds.height = bounds.height > height ? bounds.height : height;

    // The origin always has to be 0,0.  Every other coordinate has to shift by minX, minY
    coords.x -= minX;
    coords.y -= minY;

    for (const scene of subSceneChildren) {
        scene.ChildCoords.x -= minX;
        scene.ChildCoords.y -= minY;
    }

    // Add the new sub-scene to subSceneChildren
    subSceneChildren.push({
        ChildCoords : {
            x: coord.x - minX,
            y: coord.y - minY,
            width: child.width - 2 * polygonOffsetByPixels,
            height: child.height - 2 * polygonOffsetByPixels
        },
        ChildrenSceneUUIDs: childUUID
    });

    // Update flag data with the updates
    await source.setFlag(ModuleName, "Bounds", bounds);
    await source.setFlag(ModuleName, "Coords", coords);
    await source.setFlag(ModuleName, "SubSceneChildren", subSceneChildren);
}

/**
 * 
 * @param {array} a     array containing coordinate for a point on a line, ie: [x1, y1]
 * @param {array} b     array containing coordinate for other point on a line, ie: [x2, y2]
 * @returns {number}    The slope defined by the coordinates on a line
 */
function slope(a, b) {
    return ( (a[1]-b[1]) / (a[0]-b[0]) )
}