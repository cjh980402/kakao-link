const { FormData, request } = require('undici');
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

        const loginResponse = await request(
            'https://accounts.kakao.com/login?continue=https%3A%2F%2Faccounts.kakao.com%2Fweblogin%2Faccount%2Finfo',
            {
                method: 'GET',
                headers: {
                    'user-agent': this.#kakaoStatic,
                    'referer': 'https://accounts.kakao.com'
                }
            }
        );

        switch (loginResponse.statusCode) {
            case 200:
                this.#referer =
                    'https://accounts.kakao.com/login?continue=https%3A%2F%2Faccounts.kakao.com%2Fweblogin%2Faccount%2Finfo';
                const $ = load(await loginResponse.body.text());

                let cryptoKey;
                const nextData = $('#__NEXT_DATA__').get(0)?.children[0]?.data;
                if (nextData) {
                    cryptoKey = JSON.parse(nextData).props.pageProps.pageContext.commonContext.p;
                } else {
                    cryptoKey = $('input[name=p]').attr('value');
                }

                this.#getCookies(loginResponse);
                this.#getCookies(
                    await request(
                        'https://stat.tiara.kakao.com/track?d=%7B%22sdk%22%3A%7B%22type%22%3A%22WEB%22%2C%22version%22%3A%221.1.15%22%7D%7D'
                    )
                );

                const form = new FormData();
                form.set('os', 'web');
                form.set('webview_v', '2');
                form.set('email', String(AES.encrypt(email, cryptoKey)));
                form.set('password', String(AES.encrypt(password, cryptoKey)));
                form.set('continue', decodeURIComponent(this.#referer.split('continue=')[1]));
                form.set('third', 'false');
                form.set('k', 'true');
                const response = await request('https://accounts.kakao.com/weblogin/authenticate.json', {
                    body: form,
                    method: 'POST',
                    headers: {
                        'user-agent': this.#kakaoStatic,
                        'referer': this.#referer,
                        'cookie': this.#pickCookies()
                    }
                });

                const jsonText = await response.body.text();
                switch (JSON.parse(jsonText).status) {
                    case -450:
                        throw new ReferenceError('이메일 또는 비밀번호가 올바르지 않습니다.');
                    case -481:
                    case -484:
                        throw new ReferenceError(jsonText);
                    case 0:
                        this.#getCookies(response);
                        break;
                    default:
                        throw new Error(`로그인 과정에서 에러가 발생하였습니다.\n${jsonText}`);
                }
                break;
            default:
                throw new Error(`로그인을 실패하였습니다. 오류코드: ${loginResponse.statusCode}`);
        }
    }

    async send(room, params, type = 'default') {
        const form = new FormData();
        form.set('app_key', this.#apiKey);
        form.set('validation_action', type);
        form.set('validation_params', JSON.stringify(params));
        form.set('ka', this.#kakaoStatic);
        form.set('lcba', '');
        const response = await request('https://sharer.kakao.com/talk/friends/picker/link', {
            body: form,
            method: 'POST',
            headers: {
                'user-agent': this.#kakaoStatic,
                'referer': this.#referer,
                'cookie': this.#pickCookies()
            }
        });

        switch (response.statusCode) {
            case 400:
                throw new ReferenceError(
                    '템플릿 객체가 올바르지 않거나, Web 플랫폼에 등록된 도메인과 현재 도메인이 일치하지 않습니다.'
                );
            case 401:
                throw new ReferenceError('유효한 API KEY가 아닙니다.');
            case 200:
                this.#getCookies(response);
                const $ = load(await response.body.text());
                const validatedTalkLink = $('#validatedTalkLink').attr('value');
                const csrfToken = $('div').last().attr('ng-init')?.split("'")[1];
                if (!csrfToken) {
                    throw new ReferenceError('로그인 세션이 만료되어서 다시 로그인 해야합니다.');
                }

                const { chats, securityKey } = await (
                    await request('https://sharer.kakao.com/api/talk/chats', {
                        headers: {
                            'user-agent': this.#kakaoStatic,
                            'referer': 'https://sharer.kakao.com/talk/friends/picker/link',
                            'cookie': this.#pickCookies(),
                            'Csrf-Token': csrfToken,
                            'App-Key': this.#apiKey
                        }
                    })
                ).body.json();

                const chat = chats?.find((v) => v.title === room);
                if (!chat?.id) {
                    throw new ReferenceError(`방 이름 ${room}을 찾을 수 없습니다.`);
                }

                await request('https://sharer.kakao.com/api/talk/message/link', {
                    body: JSON.stringify({
                        receiverChatRoomMemberCount: [1],
                        receiverIds: [chat.id],
                        receiverType: 'chat',
                        securityKey: securityKey,
                        validatedTalkLink: JSON.parse(validatedTalkLink)
                    }),
                    method: 'POST',
                    headers: {
                        'user-agent': this.#kakaoStatic,
                        'referer': 'https://sharer.kakao.com/talk/friends/picker/link',
                        'content-type': 'application/json;charset=UTF-8',
                        'cookie': this.#pickCookies(),
                        'Csrf-Token': csrfToken,
                        'App-Key': this.#apiKey
                    }
                });
                break;
            default:
                throw new Error('템플릿 인증 과정 중에 알 수 없는 오류가 발생하였습니다.');
        }
    }

    #getCookies(response) {
        const cookies = [response.headers['set-cookie']].flat().reduce((acc, cur) => {
            const [key, val] = cur.split(';')[0].split('=');
            acc[key.trim()] = val?.trim() ?? '';
            return acc;
        }, {});
        Object.assign(this.#cookies, cookies);
    }

    #pickCookies() {
        return Object.entries(this.#cookies)
            .map(([key, val]) => `${key}=${val}`)
            .join('; ');
    }
}

module.exports = KakaoLink;
