# MARICODE — Mac 앱

1.1.1은 전체 초기화를 실행하지 않으며1.1.0에서 만든 데이터를 보존한다. 이전1.1.0 전환: Applications에서 이전 앱을 정상 교체한 뒤 첫 실행에서 기존 앱 데이터(등록·대화·설정·Hub/Runner)를 한 번 정리한다. 외부 CLI/프로젝트는 보존한다. 완료 표식 이후 새 데이터는 보존한다. 일반 업데이트 보존 정책의 이번 전환 예외이며 DMG 마운트 시 실행하는 설치 스크립트는 아니다.

제품 코드는 [AGPL-3.0-only](LICENSE)다. 적용 범위는 `apps/mac-launcher`와 `pilots/hapi/client-probe`이며 제3자 고지는 유지한다. [사용 안내](USER-GUIDE.txt), [빌드 방법](BUILDING.txt), [고지](NOTICES.txt)는 앱 도움말에서도 볼 수 있다. 공개 릴리스의 설치·검증 범위는 저장소 README와 릴리스 안내를 따른다. 작업 화면은 앱 안에서 열린다.

## 화면과 실행 구조

Swift/AppKit + macOS의 WKWebView 안에서 공통 웹 UI를 실행한다. 첫 실행은 역할 선택 후 빈 작업 공간을 연다. 프로젝트 폴더를 추가한 뒤 새 세션에서 Codex·Claude를 선택한다. 폴더 등록만으로 Git 또는 AI 작업을 시작하지 않는다. AI 실행 파일이 없으면 공식 설치가 필요하고 구독 로그인은 사용자가 공식 창에서 완료한다.

왼쪽 목록은 프로젝트 → 작업공간 → AI 세션 순서다. 프로젝트는 기준 폴더, 작업공간은 실제 실행 폴더 또는 Git worktree, 세션은 AI 대화다. 중앙에서 작업공간과 AI를 선택해 새 대화를 만들며 브랜치/worktree 준비는 선택 사항이다.

컴퓨터는 왼쪽 하단 호스트 메뉴에서 전환한다. 이 Mac의 로컬+서버 역할은 한 작업 화면을 공유하며 원격 컴퓨터는 각각 독립 WebView를 사용한다. 연결·설정은 같은 창에서 열고 제목줄의 뒤로가기로 작업 화면에 복귀한다. 컴퓨터 전환은 서버 작업을 종료하지 않는다. 원격 주소는 LAN 사설 주소·`.local`·Tailscale `.ts.net` HTTPS로 제한하며 원격 페이지에는 native 설정 bridge를 제공하지 않는다.

앱은 로컬 웹61192와 Hub61193을 소유한다. 첫 로컬 연결에서 번들 HAPI 설정과 빈 전용 프로필을 만들며 인증정보를 복사하지 않는다. 로컬 UI는 30초 일회용 grant를 앱 내부에서 소비해 인증한다. 원격 토큰은 해당 컴퓨터의 작업 탭에서 입력하며 컴퓨터 간 전달하지 않는다. 프로젝트 목록은 실행 머신의 `projects.json`에 저장한다. 세션 생성은 등록된 폴더 ID만 받아 실제 경로를 해석한다.

Runner 시작 시 등록된 프로젝트를 각각 명시해 폴더 접근을 제한한다. 기본 Runner가 쉬고 있으면 새 폴더를 추가할 때 다시 준비하고, 실행 중인 세션이 있으면 그 폴더에 전용 Runner(별도 HAPI_HOME·기기 ID)를 띄워 기존 세션을 멈추지 않는다. 세션은 만든 Runner에서만 재개되므로 폴더별 배정은 `runner.assignments.json`에 고정한다. 전용 Runner는 앱 종료 시 함께 정리하며, 쉬는 전용 Runner의 자동 종료는 아직 없다.

진행 중 작업·승인·생성 미확인 기록·소유 불명 Runner가 있으면 정상 종료를 차단한다. 기존 Hub/Paseo를 인수하거나 포트 충돌 프로세스를 종료하지 않는다. 앱 재실행은 설정과 프로젝트를 보존하며 불확실한 작업 요청을 자동으로 다시 보내지 않는다.

## 빌드와 격리 시험

Node26.7 이상과 기존 macOS Swift 도구가 필요하다. 빌드는 새 소프트웨어를 내려받지 않는다.

```sh
node apps/mac-launcher/build.mjs /existing/node-root /new/output /verified/hapi-artifact-directory --release
'/new/output/Maricode.app/Contents/MacOS/Merry' --data-directory /absolute/path/to/isolated-data
```

HAPI 입력 폴더는 `package-hapi.mjs`의 고정 SHA-256에 맞는 `hapi`, `LICENSE`, `source.tar.gz`를 포함해야 한다. 현재 고정 버전은0.33.3 arm64다. 앱에는 Node 전체 LICENSE·HAPI 고지·제품 소스가 포함된다. HAPI 고정 소스는 ad-hoc 빌드에는 앱 안에, Developer ID 공증본에는 같은 릴리스의 별도 첨부에 보관한다. 원래 AI 계정·실행 자료는 포함하지 않는다.

release bundle ID는 `dev.maricode.desktop`, 데이터는 `~/Library/Application Support/MARICODE`다. 개발 빌드는 `dev.merry.launcher.preview`/`Merry Development`를 사용한다. 자동 이관하지 않으며 포트가 같아 동시에 시작할 수 없다. `--data-directory`는 격리 시험용이다.

## 패키징과 업데이트

```sh
node apps/mac-launcher/dmg.mjs /built/Maricode.app /new/dmg-output /verified/upstream-sources
```

기본 명령은 앱 사본에 ad-hoc 서명한 뒤 DMG·제품 소스·SHA-256·빌드 안내를 생성한다. Developer ID 공증은 명시적인 `MARICODE_SIGN_IDENTITY`(인증서 SHA-1)와 `MARICODE_NOTARY_PROFILE`(기존 키체인 프로필)을 함께 지정한다. 공증 실패 시 멈추며 ad-hoc으로 대체하지 않는다. 자세한 절차와 별도 HAPI 소스 첨부는 `BUILDING.txt`를 따른다. 원본 번들과 기존 출력은 덮어쓰지 않는다. 공개 저장소/릴리스 게시와 DMG 생성은 별개다.

업데이트는 작업을 안전하게 종료한 뒤 앱만 교체한다. Application Support의 설정·프로젝트·프로필·세션 자료를 삭제하지 않는다. 다른 깨끗한 Mac 전체 설치, 다운로드 격리 Gatekeeper 최초 허용, 실제 OS 파일 권한 왕복은 확인된 범위와 구분해 안내한다.

## 현재 후보의 주요 변경

- 프로젝트·작업공간·세션 계층과 중앙 새 작업 흐름, 양쪽 패널 토글 및 호스트 메뉴.
- 입력창 가까이의 승인·질문, 접는 도구 묶음, 파일 변경 내용과 작업 시간 표시.
- 파일 선택·Finder 파일 및 이미지 붙여넣기, 미리보기·개별 제거·AI 첨부 전송.
- 같은 이름의 첨부 제거 버튼 구분과 서버 갱신 중 포커스 유지.
- 새 M 앱 아이콘과 기존 세션 재개·설정 보존.

이 후보의 네이티브 첨부 응답·질문·허용/거절은 실제 Claude로 확인했다. Codex 첨부 응답은 별도 실제 HTTP 시험 결과이며, Codex 질문 화면과 하위 에이전트 전체 동작을 동일하게 실기 검증했다고 보지 않는다. 첨부·입력 초안은 현재 창의 메모리에만 남는다. 다중 AI 계정 선택·QR 연결·기기 간 세션 이식은 제공하지 않는다. 자세한 지원 범위는 사용 안내를 따른다.
