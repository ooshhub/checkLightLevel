/* globals on findObjs getObj playerIsGM log sendChat PathMath */

const checkLightLevel = (() => { //eslint-disable-line no-unused-vars

  const scriptName = 'checkLightLevel',
    scriptVersion = '0.3.1';

  const getSelectedToken = (selected) => {
    const selectedId = selected[0] ? selected[0]._id : null
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

  const checkLightLevelOfToken = (token) => {
    if (typeof(PathMath) !== 'object') return { err: `Aborted - This script requires PathMath.` };
    const tokenPage = getPageOfToken(token),
      litBy = { bright: false, dim: false, global: false };
    // console.info(tokenPage);
    if (!tokenPage || !tokenPage.id) return { err: `Couldn't find token or token page.` };
    litBy.global = checkGlobalIllumination(tokenPage);
    const allTokens = findObjs({ type: 'graphic', _pageid: tokenPage.id }),
      allLightTokens = allTokens.filter(token => (token.get('emits_bright_light') || token.get('emits_low_light')));
    // console.log(allLightTokens);
    for (let i=0; i<allLightTokens.length; i++) {
      const tokenSeparation = getTokenSeparation(token, allLightTokens[i]),
        losBlocked = checkLineOfSight(token, allLightTokens[i], tokenSeparation, tokenPage);
      if (losBlocked) {
        // console.warn(`LOS blocked to emitter "${allLightTokens[i].name}"`);
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
        break;
      }
      else if (tokenSeparation <= dimRange) {
        litBy.dim = true;
      }
    }
    return litBy;
  }
    
  const handleInput = (msg) => {
    // if (typeof(PathMath) !== 'object') return;
    if (msg.type === 'api' && /!checklight/i.test(msg.content) && playerIsGM(msg.playerid)) {
      const token = getSelectedToken(msg.selected || []);
      if (!token) return postChat(`Nothing selected.`);
      const checkResult = checkLightLevelOfToken(token),
        tokenName = token.get('name');
      if (checkResult.err) {
        postChat(checkResult.err);
        return;
      }
      let messages = [];
      if (checkResult.global) messages.push(`${tokenName} is in ${(checkResult.global*100).toFixed(1)}% global light.`);
      if (checkResult.bright) messages.push(`${tokenName} is in direct bright light.`);
      else if (checkResult.dim) messages.push(`${tokenName} is in direct dim light.`);
      else if (!checkResult.global) messages.push(`${tokenName} is in darkness.`);
      if (messages.length) {
        let opacity = checkResult.bright ? 1
          : checkResult.dim ? 0.5
          : 0.1;
        if (typeof(checkResult.global) === 'number') opacity = Math.max(checkResult.global.toFixed(2), opacity);
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
   * @property {?boolean} dim - token is lit by dim light, null on error
   * @property {?float} global - token is in <float between 0 and 1> daylight, false on no daylight, null on error
   * @property {?string} err - error message, only on error
   * 
   * @param {string | object} tokenOrTokenId - Roll20 Token object, or token UID string
   * @returns {LitBy}
   */
  const isLitBy = (tokenOrTokenId) => {
    const output = { bright: null, dim: null, global: null }
    const token = tokenOrTokenId && typeof(tokenOrTokenId) === 'object' && tokenOrTokenId.id ? tokenOrTokenId
      : typeof(tokenOrTokenId) === 'string' ? getObj('graphic', tokenOrTokenId)
      : null;
    const checkResult = token && token.id ? checkLightLevelOfToken(token)
      : { err: `Could not find token from supplied ID.` };
    Object.assign(output, checkResult ? checkResult : { err: `Could not find token's page, or bad page data.` });
    return output;
  }

  on('ready', () => {
    on('chat:message', handleInput);
    log(`${scriptName} v${scriptVersion}`);
  });

  return { isLitBy }

})();