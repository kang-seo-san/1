/**
 * 음성녹음 → 카카오톡 "나에게 보내기" 자동 전송 스크립트
 *
 * 동작
 *  - 구글드라이브 '음성녹음' 폴더를 5분마다 확인함
 *  - 새로 올라온 녹음파일이 있으면 카카오톡 '나와의 채팅'으로 파일 링크를 보냄
 *  - 통화녹음 파일(이름에 '통화', 'Call' 포함)은 보내지 않음
 *
 * 사용법은 같은 폴더의 README.md 참고
 */

// ===== ① 사용자 설정 (여기만 바꾸면 됨) =====
const CONFIG = {
  DRIVE_FOLDER_NAME: '음성녹음',          // 녹음파일이 동기화되는 구글드라이브 폴더 이름
  KAKAO_REST_API_KEY: '여기에_REST_API_키_입력',
  KAKAO_CLIENT_SECRET: '',               // 카카오 앱에서 Client Secret을 '사용함'으로 했으면 입력, 아니면 비워둠
  REDIRECT_URI: 'https://localhost',     // 카카오 개발자 콘솔에 등록한 Redirect URI와 똑같이
  AUTH_CODE: '여기에_인가코드_입력',        // 최초 1회만 사용 (README 4단계)
  EXCLUDE_KEYWORDS: ['통화', 'Call', 'call'], // 이 단어가 파일 이름에 있으면 제외
  AUDIO_EXTENSIONS: ['m4a', 'mp3', 'wav', 'amr', '3gp', 'aac', 'ogg'],
};
// ==========================================

const props = PropertiesService.getScriptProperties();

/** [최초 1회 실행] 인가코드로 카카오 토큰을 발급받아 저장함 */
function setup_1_카카오토큰발급() {
  const payload = {
    grant_type: 'authorization_code',
    client_id: CONFIG.KAKAO_REST_API_KEY,
    redirect_uri: CONFIG.REDIRECT_URI,
    code: CONFIG.AUTH_CODE,
  };
  if (CONFIG.KAKAO_CLIENT_SECRET) payload.client_secret = CONFIG.KAKAO_CLIENT_SECRET;

  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post',
    payload: payload,
    muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error('토큰 발급 실패: ' + res.getContentText() +
      '\n→ 인가코드는 1회용이고 몇 분 안에 만료됨. README 4단계를 다시 해서 새 코드를 넣어 주세요.');
  }
  saveTokens_(data);
  Logger.log('토큰 발급 성공. 이제 setup_2_테스트메시지 를 실행해 보세요.');
}

/** [최초 1회 실행] 카톡 나에게 테스트 메시지를 보냄 */
function setup_2_테스트메시지() {
  sendKakaoMemo_('✅ 음성녹음 자동전송 연결 테스트 성공', 'https://drive.google.com');
  Logger.log('카카오톡 나와의 채팅을 확인하세요.');
}

/** [최초 1회 실행] 5분마다 자동 실행되도록 예약하고, 기존 파일은 '이미 보냄'으로 표시함 */
function setup_3_자동실행시작() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'checkNewRecordings')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkNewRecordings').timeBased().everyMinutes(5).create();

  // 지금 폴더에 있는 파일은 보내지 않도록 기록 (예전 녹음이 한꺼번에 오는 것 방지)
  const sent = {};
  const files = getFolder_().getFiles();
  while (files.hasNext()) sent[files.next().getId()] = true;
  props.setProperty('SENT_IDS', JSON.stringify(sent));
  Logger.log('자동실행 시작. 기존 파일 ' + Object.keys(sent).length + '개는 건너뜀.');
}

/** [자동 실행] 새 녹음파일을 찾아 카톡으로 보냄 */
function checkNewRecordings() {
  const sent = JSON.parse(props.getProperty('SENT_IDS') || '{}');
  const files = getFolder_().getFiles();
  const newFiles = [];

  while (files.hasNext()) {
    const f = files.next();
    if (sent[f.getId()]) continue;
    if (!isTargetFile_(f.getName())) {
      sent[f.getId()] = true;        // 제외 대상(통화녹음 등)은 다시 검사하지 않도록 기록
      continue;
    }
    newFiles.push(f);
  }

  try {
    newFiles
      .sort((a, b) => a.getDateCreated() - b.getDateCreated())
      .forEach(f => {
        const size = (f.getSize() / 1024 / 1024).toFixed(1);
        const when = Utilities.formatDate(f.getDateCreated(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
        sendKakaoMemo_(
          '🎙 새 음성녹음\n' + f.getName() + '\n' + when + ' · ' + size + 'MB',
          f.getUrl()
        );
        sent[f.getId()] = true;      // 전송 성공한 파일만 '보냄' 처리 → 실패분은 다음 실행 때 재시도
      });
  } finally {
    props.setProperty('SENT_IDS', JSON.stringify(sent));
  }
}

// ===== 내부 함수 =====

function isTargetFile_(name) {
  const ext = name.split('.').pop().toLowerCase();
  if (CONFIG.AUDIO_EXTENSIONS.indexOf(ext) === -1) return false;
  return !CONFIG.EXCLUDE_KEYWORDS.some(k => name.indexOf(k) !== -1);
}

function getFolder_() {
  const it = DriveApp.getFoldersByName(CONFIG.DRIVE_FOLDER_NAME);
  if (!it.hasNext()) throw new Error('구글드라이브에 "' + CONFIG.DRIVE_FOLDER_NAME + '" 폴더가 없음');
  return it.next();
}

function saveTokens_(data) {
  props.setProperty('ACCESS_TOKEN', data.access_token);
  props.setProperty('ACCESS_EXPIRES', String(Date.now() + (data.expires_in - 300) * 1000));
  if (data.refresh_token) props.setProperty('REFRESH_TOKEN', data.refresh_token); // 갱신될 때만 내려옴
}

function getAccessToken_() {
  if (Date.now() < Number(props.getProperty('ACCESS_EXPIRES') || 0)) {
    return props.getProperty('ACCESS_TOKEN');
  }
  const payload = {
    grant_type: 'refresh_token',
    client_id: CONFIG.KAKAO_REST_API_KEY,
    refresh_token: props.getProperty('REFRESH_TOKEN'),
  };
  if (CONFIG.KAKAO_CLIENT_SECRET) payload.client_secret = CONFIG.KAKAO_CLIENT_SECRET;

  const res = UrlFetchApp.fetch('https://kauth.kakao.com/oauth/token', {
    method: 'post', payload: payload, muteHttpExceptions: true,
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) {
    throw new Error('토큰 갱신 실패(약 2개월 미사용 시 만료): ' + res.getContentText() +
      '\n→ README 4~5단계를 다시 해 주세요.');
  }
  saveTokens_(data);
  return data.access_token;
}

function sendKakaoMemo_(text, url) {
  const template = {
    object_type: 'text',
    text: text,
    link: { web_url: url, mobile_web_url: url },
    button_title: '녹음 열기',
  };
  const res = UrlFetchApp.fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'post',
    headers: { Authorization: 'Bearer ' + getAccessToken_() },
    payload: { template_object: JSON.stringify(template) },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('카톡 전송 실패: ' + res.getContentText());
  }
}
