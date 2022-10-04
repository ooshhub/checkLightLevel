# checkLightLevel
 Roll20 Mod Script

Checks the light level of the currently selected token.

Usage: `!checkLight`

From other scripts: `checkLightLevel.litBy(tokenOrId)`

  ```/**
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
   isLityBy(tokenOrTokenId)
```
