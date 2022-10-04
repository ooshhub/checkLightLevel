/* globals on findObjs getObj playerIsGM log sendChat PathMath Plugger */

const checkLightLevel = (() => { //eslint-disable-line no-unused-vars

  const scriptName = 'checkLightLevel',
    scriptVersion = '0.4.1';

  const getSelectedToken = (selected) => {
    const selectedId = selected && selected[0] ? selected[0]._id : null
    return selectedId ? getObj('graphic', selectedId) : null;
  }

  const getPageOfToken = (token) => token && token.id ? getObj('page', token.get('_pageid')) : null;

  const getSeparation = (point1, point2) => {
    const delta = { x: point1.x - point2.x, y: point1.y - point2.y },
    distance = Math.sqrt(delta.x**2 + delta.y**2);
    // console.info(pos1, pos2, delta, distance);
    return distance;
  }

  const getTokenSeparation = (token1, token2) => {
    if (!token1 || !token2) return;
    const pos1 = { x: parseInt(token1.get('left')), y: parseInt(token1.get('top')) },
      pos2 = { x: parseInt(token2.get('left')), y: parseInt(token2.get('top')) };
    if (![pos1.x, pos1.y, pos2.x, pos2.y].reduce((valid, val) => (valid === true && Number.isSafeInteger(val)) ? true : false, true)) return null;
    return getSeparation(pos1, pos2);
  }

  const feetToPixels = (feetValue, page) => {
    if (!page) return null;
    const gridPixelMultiplier = page.get('snapping_increment'),
      gridUnitScale = page.get('scale_number');
    const pixelValue = feetValue/gridUnitScale*(gridPixelMultiplier*70);
    // console.warn(`pixel distance: ${pixelValue}`);
    return pixelValue;
  }

  const checkGlobalIllumination = (page) => {
    if (!page || !page.id) return false;
    return page.get('daylight_mode_enabled') ? parseFloat(page.get('daylightModeOpacity')) : false;
  }

  const isOneWayAndTransparent = (segment, lightFlowAngle, oneWayReversed) => {
    if (!segment || segment.length < 2) return;
    const delta = { x: segment[1][0] - segment[0][0], y: segment[0][1] - segment[1][1] }
    const segmentAngle = getAngleFromX(delta.x, delta.y);
    // console.info(`Segment angle is ${segmentAngle}`);
    const transparencyAngle = oneWayReversed ? segmentAngle - 90 : segmentAngle + 90;
    const angleDifference = Math.abs(transparencyAngle - lightFlowAngle);
    // console.warn(`Transparency diff ${angleDifference}`);
    return angleDifference < 90 ? true : false;
  }

  const toDegrees = (rads) => rads*180/Math.PI;

  const getAngleFromX = (x, y) => toDegrees(Math.atan2(y, x));

  const checkLineOfSight = (token1, token2, range, page) => {
    const pos1 = { x: parseInt(token1.get('left')), y: parseInt(token1.get('top')) },
      pos2 = { x: parseInt(token2.get('left')), y: parseInt(token2.get('top')) },
      blockingPaths = findObjs({ type: 'path', pageid: page.id, layer: 'walls' }).filter(path => path.get('barrierType') !== 'transparent');
    const losPath = new PathMath.Path([[pos1.x, pos1.y, 0], [pos2.x, pos2.y, 0]]);
    let losBlocked = null;
    for (let i=0; i<blockingPaths.length; i++) {
      let pathData;
      const isOneWayWall = blockingPaths[i].get('barrierType') === 'oneWay',
        oneWayReversed = isOneWayWall ? blockingPaths[i].get('oneWayReversed') : null,
        lightFlowAngle = isOneWayWall ? getAngleFromX(pos1.x - pos2.x, pos2.y - pos1.y) : null;
      try { pathData = JSON.parse(blockingPaths[i].get('path')); } catch(e) { console.error(e) }
      if (!pathData) continue;
      const pathTop = blockingPaths[i].get('top') - (blockingPaths[i].get('height')/2),
        pathLeft = blockingPaths[i].get('left') - (blockingPaths[i].get('width')/2);
      const pathVertices = pathData.map(vertex => [ vertex[1] + pathLeft, vertex[2] + pathTop, 0 ]);
      const wallPath = new PathMath.Path(pathVertices);
      // console.info(losPath, wallPath);
      const wallSegments = wallPath.toSegments(),
        losSegments = losPath.toSegments();
      // console.warn(wallSegments, losSegments);
      for (let w=0; w<wallSegments.length; w++) {
        if (losBlocked) break;
        const skipOneWaySegment = isOneWayWall ? isOneWayAndTransparent(wallSegments[w], lightFlowAngle, oneWayReversed) : false;
        if (skipOneWaySegment) {
          // console.info('skipping due to one-way transparency');
          continue;
        }
        for (let l=0; l<losSegments.length; l++) {
          const intersect = PathMath.segmentIntersection(wallSegments[w], losSegments[l]);//wallPath.intersects(losPath);
          if (intersect) {
            // console.warn(`Found intersect, skipping light source`, blockingPaths[i]);
            losBlocked = blockingPaths[i];
            break;
          }
        }
      }
      if (losBlocked) break;
    }
    return losBlocked;
  }

  /**
   * Use cubic fade out to approximate the light level in dim light at different ranges
   * @param {integer} tokenSeparation - pixel distance, center to center
   * @param {integer} dimLightRadius - pixel radius of dim light from the emitter
   * @param {integer} brightLightRadius - pixel radius of bright light from the emitter
   * @returns {float} - light level multiplier, 0 - 1isLitBy
   */
  const getDimLightFalloff = (tokenSeparation, dimLightRadius, brightLightRadius, gridPixelSize) => {
    const dimLightOnlyRadius = (dimLightRadius - brightLightRadius) + gridPixelSize/2,
      tokenDimLightDistance = tokenSeparation - brightLightRadius;
    const lightLevelWithFalloff = (1-(tokenDimLightDistance/dimLightOnlyRadius)**3) * 0.5;
    // console.info(tokenDimLightDistance, dimLightOnlyRadius, lightLevelWithFalloff);
    return lightLevelWithFalloff;
  }

  const checkLightLevelOfToken = (token) => {
    if (typeof(PathMath) !== 'object') return { err: `Aborted - This script requires PathMath.` };
    const tokenPage = getPageOfToken(token),
      litBy = { bright: false, dim: [], daylight: false, total: 0 };
    // console.info(tokenPage);
    const gridPixelSize = tokenPage.get('snapping_increment') * 70;
    if (!tokenPage || !tokenPage.id) return { err: `Couldn't find token or token page.` };
    litBy.daylight = checkGlobalIllumination(tokenPage);
    if (litBy.daylight) litBy.total += litBy.daylight;
    const allTokens = findObjs({ type: 'graphic', _pageid: tokenPage.id }),
      allLightTokens = allTokens.filter(token => (token.get('emits_bright_light') || token.get('emits_low_light')) && token.get('layer') !== 'gmlayer');
    // console.log(allLightTokens);
    for (let i=0; i<allLightTokens.length; i++) {
      if (litBy.bright || litBy.total >= 1) break;
      const tokenSeparation = getTokenSeparation(token, allLightTokens[i]),
        losBlocked = checkLineOfSight(token, allLightTokens[i], tokenSeparation, tokenPage);
      if (losBlocked) {
        continue;
      }
      const brightRangeFeet = allLightTokens[i].get('bright_light_distance'),
        dimRangeFeet = allLightTokens[i].get('low_light_distance'),
        brightRange = feetToPixels(brightRangeFeet, tokenPage),
        dimRange = feetToPixels(dimRangeFeet, tokenPage);
      // console.info(tokenSeparation, brightRange, dimRange);
      if (brightRange == null || dimRange == null) continue;
      if (tokenSeparation <= brightRange) {
        litBy.bright = true;
        litBy.total = 1;
        break;
      }
      else if (tokenSeparation <= dimRange) {
        litBy.dim.push(allLightTokens[i]);
        litBy.total += getDimLightFalloff(tokenSeparation, dimRange, brightRange, gridPixelSize);
      }
    }
    litBy.total = Math.min(litBy.total, 1);
    return litBy;
  }
    
  const handleInput = (msg) => {
    // console.log(msg);
    // if (msg.eval) handleMetaRequest(msg);
    // if (typeof(PathMath) !== 'object') return;
    if (msg.type === 'api' && /!checklight/i.test(msg.content) && playerIsGM(msg.playerid)) {
      const token = getSelectedToken(msg.selected || []);
      if (!token) return postChat(`Nothing selected.`);
      const checkResult = checkLightLevelOfToken(token),
        tokenName = token.get('name') || 'Nameless Token';
      if (checkResult.err) {
        postChat(checkResult.err);
        return;
      }
      let messages = [];
      if (checkResult.daylight) messages.push(`${tokenName} is in ${(checkResult.daylight*100).toFixed(0)}% global light.`);
      if (checkResult.bright) messages.push(`${tokenName} is in direct bright light.`);
      else if (checkResult.dim.length) messages.push(`${tokenName} is in ${checkResult.total >= 1 ? `at least ` : ''}${checkResult.dim.length} sources of dim light.`);
      else if (!checkResult.daylight) messages.push(`${tokenName} is in darkness.`);
      if (!checkResult.bright && checkResult.total > 0) messages.push(`${tokenName} is in ${parseInt(checkResult.total*100)}% total light level.`)
      if (messages.length) {
        let opacity = checkResult.bright ? 1
          : checkResult.total > 0.2 ? checkResult.total
          : 0.2;
        if (typeof(checkResult.daylight) === 'number') opacity = Math.max(checkResult.daylight.toFixed(2), opacity);
        const chatMessage = createChatTemplate(token, messages, opacity);
        postChat(chatMessage);
      }
    }
  }

  const createChatTemplate = (token, messages, opacity) => {
    return `
      <div class="light-outer" style="background: black; border-radius: 1rem; border: 2px solid #4c4c4c; white-space: nowrap;">
        <div class="light-avatar" style="	display: inline-block!important; width: 20%; padding: 0.5rem;">
          <img src="${token.get('imgsrc')}" style="opacity: ${opacity};"/>
        </div>
        <div class="light-text" style="display: inline-block; color: whitesmoke; vertical-align: middle; width: 75%; white-space: normal;">
          ${messages.reduce((out, msg) => out += `<p>${msg}</p>`, '')}
        </div>
      </div>
      `.replace(/\n/g, '');
  }

  const postChat = (chatText, whisper = 'gm') => {
    const whisperText = whisper ? `/w "${whisper}" ` : '';
    sendChat(scriptName, `${whisperText}${chatText}`);
  }

  /**
   * @typedef {object} LitBy
   * @property {?boolean} bright - token is lit by bright light, null on error
   * @property {?array} dim - dim light emitters found to be illuminating selected token, null on error
   * @property {?float} daylight - token is in <float between 0 and 1> daylight, false on no daylight, null on error
   * @property {?float} total - total light multiplier from adding all sources, max 1, null on error
   * @property {?string} err - error message, only on error
   * 
   * @param {string | object} tokenOrTokenId - Roll20 Token object, or token UID string
   * @returns {LitBy}
   */
  const isLitBy = (tokenOrTokenId) => {
    const output = { bright: null, dim: null, daylight: null, total: null }
    const token = tokenOrTokenId && typeof(tokenOrTokenId) === 'object' && tokenOrTokenId.id ? tokenOrTokenId
      : typeof(tokenOrTokenId) === 'string' ? getObj('graphic', tokenOrTokenId)
      : null;
    const checkResult = token && token.id ? checkLightLevelOfToken(token)
      : { err: `Could not find token from supplied ID.` };
    Object.assign(output, checkResult ? checkResult : { err: `Could not find token's page, or bad page data.` });
    return output;
  }

  // Meta toolbox plugin
  const checklight = (msg) => {
    const err = [];
    const token = getSelectedToken(msg.selected);
    if (!token || !token.id) err.push(`checklight plugin: no selected token`);
    else {
      const checkResult = checkLightLevelOfToken(token);
      return typeof(checkResult.total) === 'number' ? parseFloat(checkResult.total).toFixed(4) : 0;
    }
    if (err.length) err.forEach(e => log(e));
    return '';
  }
  const registerWithMetaToolbox = () => {
    try {
      Plugger.RegisterRule(checklight);
      // console.info(`Registered with Plugger`);
      }
    catch (e) { log(`ERROR Registering ${scriptName} with PlugEval: ${e.message}`); }
  }

  on('ready', () => {
    if (typeof(Plugger) === 'object') registerWithMetaToolbox();
    on('chat:message', handleInput);
    log(`${scriptName} v${scriptVersion}`);
  });

  return { isLitBy }

})();