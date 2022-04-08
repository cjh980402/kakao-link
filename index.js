const { fetch, FormData } = require('undici');
const { load } = require('cheerio');
const { AES } = require('./crypto');

class KakaoLink {
    #apiKey;
    #cookies = {};
    #referer = null;
    #kakaoStatic = 'sdk/1.36.6 os/javascript lang/en-US device/Win32 origin/';

    constructor(apiKey, location) {
        if (apiKey.constructor !== String || location.constructor !== String) {
            throw new TypeError('매개변수의 타입은 String이어야 합니다.');
        }
        if (apiKey.length !== 32) {
            throw new ReferenceError('API KEY는 32자여야 합니다.');
        }
        if (!/^https?\:\/\/.+/.test(location)) {
            throw new ReferenceError('도메인 주소의 형식이 올바르지 않습니다.');
        }

        this.#apiKey = apiKey;
        this.#kakaoStatic += encodeURIComponent(location);
    }

    async login(email, password) {
        if (email.constructor !== String) {
            throw new TypeError('이메일의 타입은 String이어야 합니다.');
        }
        if (password.constructor !== String) {
            throw new TypeError('비밀번호의 타입은 String이어야 합니다.');
        }
        if (!this.#apiKey) {
            throw new ReferenceError('로그인 메서드를 카카오 SDK가 초기화되기 전에 호출하였습니다.');
        }

        const loginResponse = await fetch(
            'https://accounts.kakao.com/login?continue=https%3A%2F%2Faccounts.kakao.com%2Fweblogin%2Faccount%2Finfo',
            {
                method: 'GET',
                headers: {
                    'User-Agent': this.#kakaoStatic,
                    'referer': 'https://accounts.kakao.com'
                }
            }
        );

        switch (loginResponse.status) {
            case 200:
                this.#referer = loginResponse.url;
                const $ = load(await loginResponse.text());
                const cryptoKey = $('input[name=p]').attr('value');

                Object.assign(this.#cookies, this.#getCookies(loginResponse));
                this.#cookies.TIARA = this.#getCookies(
                    await fetch(
                        'https://stat.tiara.kakao.com/track?d=%7B%22sdk%22%3A%7B%22type%22%3A%22WEB%22%2C%22version%22%3A%221.1.15%22%7D%7D'
                    )
                ).TIARA;

                const form = new FormData();
                form.set('os', 'web');
                form.set('webview_v', '2');
                form.set('email', String(AES.encrypt(email, cryptoKey)));
                form.set('password', String(AES.encrypt(password, cryptoKey)));
                form.set('continue', decodeURIComponent(this.#referer.split('continue=')[1]));
                form.set('third', 'false');
                form.set('k', 'true');
                const response = await fetch('https://accounts.kakao.com/weblogin/authenticate.json', {
                    body: form,
                    method: 'POST',
                    headers: {
                        'User-Agent': this.#kakaoStatic,
                        'Referer': this.#referer,
                        'Cookie': this.#pickCookies(this.#cookies)
                    }
                });

                const jsonText = await response.text();
                switch (JSON.parse(jsonText).status) {
                    case -450:
                        throw new ReferenceError('이메일 또는 비밀번호가 올바르지 않습니다.');
                    case -481:
                    case -484:
                        throw new ReferenceError(jsonText);
                    case 0:
                        Object.assign(this.#cookies, this.#getCookies(response));
                        break;
                    default:
                        throw new Error(`로그인 과정에서 에러가 발생하였습니다.\n${jsonText}`);
                }
                break;
            default:
                throw new Error(`로그인을 실패하였습니다. 오류코드: ${loginResponse.status}`);
        }
    }

    async send(room, params, type = 'default') {
        const form = new FormData();
        form.set('app_key', this.#apiKey);
        form.set('validation_action', type);
        form.set('validation_params', JSON.stringify(params));
        form.set('ka', this.#kakaoStatic);
        form.set('lcba', '');
        const response = await fetch('https://sharer.kakao.com/talk/friends/picker/link', {
            body: form,
            method: 'POST',
            headers: {
                'User-Agent': this.#kakaoStatic,
                'Referer': this.#referer,
                'Cookie': this.#pickCookies(this.#cookies)
            }
        });

        switch (response.status) {
            case 400:
                throw new ReferenceError(
                    '템플릿 객체가 올바르지 않거나, Web 플랫폼에 등록된 도메인과 현재 도메인이 일치하지 않습니다.'
                );
            case 401:
                throw new ReferenceError('유효한 API KEY가 아닙니다.');
            case 200:
                Object.assign(this.#cookies, this.#getCookies(response));
                const $ = load(await response.text());
                const validatedTalkLink = $('#validatedTalkLink').attr('value');
                const csrfToken = $('div').last().attr('ng-init')?.split("'")[1];
                if (!csrfToken) {
                    throw new ReferenceError('로그인 세션이 만료되어서 다시 로그인 해야합니다.');
                }

                const { chats, securityKey } = await (
                    await fetch('https://sharer.kakao.com/api/talk/chats', {
                        headers: {
                            'User-Agent': this.#kakaoStatic,
                            'Referer': 'https://sharer.kakao.com/talk/friends/picker/link',
                            'Csrf-Token': csrfToken,
                            'App-Key': this.#apiKey,
                            'Cookie': this.#pickCookies(this.#cookies)
                        }
                    })
                ).json();

                const chat = chats?.find((v) => v.title === room);
                if (!chat?.id) {
                    throw new ReferenceError(`방 이름 ${room}을 찾을 수 없습니다.`);
                }

                await fetch('https://sharer.kakao.com/api/talk/message/link', {
                    body: JSON.stringify({
                        receiverChatRoomMemberCount: [1],
                        receiverIds: [chat.id],
                        receiverType: 'chat',
                        securityKey: securityKey,
                        validatedTalkLink: JSON.parse(validatedTalkLink)
                    }),
                    method: 'POST',
                    headers: {
                        'User-Agent': this.#kakaoStatic,
                        'Referer': 'https://sharer.kakao.com/talk/friends/picker/link',
                        'Csrf-Token': csrfToken,
                        'App-Key': this.#apiKey,
                        'Content-Type': 'application/json;charset=UTF-8',
                        'Cookie': this.#pickCookies(this.#cookies)
                    }
                });
                break;
            default:
                throw new Error('템플릿 인증 과정 중에 알 수 없는 오류가 발생하였습니다.');
        }
    }

    #getCookies(response) {
        return response.headers
            .get('set-cookie')
            .split(',')
            .reduce((acc, cur) => {
                const [key, val] = cur.split(';')[0].split('=');
                acc[key.trim()] = val?.trim() ?? '';
                return acc;
            }, {});
    }

    #pickCookies(cookies) {
        return Object.entries(cookies)
            .map(([key, val]) => `${key}=${val}`)
            .join('; ');
    }
}

module.exports = KakaoLink;
