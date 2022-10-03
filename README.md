# checkLightLevel
 Roll20 Mod Script

Checks the light level of the currently selected token.

Usage: `!checkLight`

From other scripts: `checkLightLevel.litBy(tokenOrId)`

  /**
   * @typedef {object} LitBy
   * @property {?boolean} bright - token is lit by bright light, null on error
   * @property {?boolean} dim - token is lit by dim light, null on error
   * @property {?float} global - token is in <float>% daylight, false on no daylight, null on error
   * @property {?string} err - error message, only on error
   * 
   * @param {string | object} tokenOrTokenId 
   * @returns {LitBy}
   */
