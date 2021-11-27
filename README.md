# kakao-link
[![NPM Version](https://img.shields.io/npm/v/kakao-link.svg?maxAge=3600)](https://www.npmjs.com/package/kakao-link)
[![NPM Downloads](https://img.shields.io/npm/dt/kakao-link.svg?maxAge=3600)](https://www.npmjs.com/package/kakao-link)

## Installing
`npm install kakao-link`

## GitHub
- [GitHub Repository](https://github.com/cjh980402/kakao-link)

## Example
### Initialization and send kakaolink
```js
const KakaoLink = require('kakao-link');
const kakaoLink = new KakaoLink(JS_KEY, DOMAIN);

(async () => {
    await kakaoLink.login(BOT_ID, BOT_PW);
    await kakaoLink.send(
        ROOM_NAME,
        {
            link_ver: '4.0',
            template_id: TEMPLATE_ID,
            template_args: {
                TEMPLATE_ARGS
            }
        },
        'custom'
    );
})();
```