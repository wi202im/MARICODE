# 사용성 점검 (`npm run ux`)

사람이 하는 일(과업) 단위로 작업 화면을 실제 마우스·키 입력으로 따라가며, 막히는 곳과 반응 없는 곳을 찾는다.
합성 Hub(예시 세션·메시지·파일)와 실제 앱 서버, 격리 프로필의 헤드리스 Chrome을 쓴다. 실제 대화·계정·AI 호출은 없다.

```
PATH=.runtime/node-root/bin:$PATH npm run ux            # 전체
PATH=.runtime/node-root/bin:$PATH npm run ux -- 파일     # 이름에 ‘파일’이 든 과업만
```

결과: `.runtime/ux/<시각>/report.md`(Git 제외) — 과업별 단계, 실패, 1.5초 안 반응 여부, 화면 문제, 오류와 단계별 캡처.

| 파일 | 역할 |
|---|---|
| `scenarios.mjs` | 과업 목록. 단계 = [사람이 하려는 것, 동작] |
| `fake-hub.mjs` | 합성 Hub와 예시 프로젝트 |
| `browser.mjs` | Chrome 조작(텍스트·선택자로 찾기, 실제 입력, 반응 측정) |
| `audit.mjs` | 화면 점검: 화면 밖, 글자 잘림, 이름 없는 조작, 작은 클릭 영역, 겹친 조작 |
| `run.mjs` | 실행과 보고서 |

점검 → 수정 흐름은 [docs/improvement-guide.md](../../docs/improvement-guide.md) 4장(L2)을 따른다. 동작이 바뀌지 않는 작은 수정은 바로 반영하고, 동선을 바꾸는 수정은 시안으로 먼저 고른다.
새 기능을 넣을 때는 그 기능을 쓰는 과업을 `scenarios.mjs`에 추가한다.
