# Qt Pro Workbench

**VS Code에서 Qt 프로젝트를 열고, 키트를 선택해 빌드·실행·디버깅하세요.**

Windows용 개인 VS Code 확장입니다. 폴더를 먼저 열지 않고 `.pro` 또는 `CMakeLists.txt`로 프로젝트를 시작할 수 있습니다. 프로젝트 트리, Qt·컴파일러 키트, 빌드·배포·실행 설정을 한 화면에서 관리합니다.

기존 `.pro/.pri`의 빌드 규칙을 그대로 사용하며, 확장의 설정은 프로젝트 밖의 VS Code 사용자 데이터에 저장합니다. Qt 4.8.1과 구형 MinGW를 사용하는 프로젝트도 다룰 수 있습니다.

[설치](#설치) · [빠른 시작](#빠른-시작) · [사용 가이드](docs/USAGE.md) · [Codex 제어](https://github.com/linehad/qt-pro-workbench/blob/HEAD/CODEX-CONTROL.md)

## 주요 기능

| 기능 | 할 수 있는 일 |
| --- | --- |
| 프로젝트 탐색 | `.pro`, 중첩 `.pri`, `SUBDIRS`, 리소스 파일을 트리로 탐색하고 현재 편집 파일을 따라갑니다. |
| 키트 관리 | Qt·컴파일러·make·GDB 경로를 관리하고, 설치된 키트를 찾거나 Qt Creator 설정을 최초 한 번 가져옵니다. |
| 빌드·배포·실행 | Debug/Release와 사용자 빌드 구성, 여러 실행 프로그램, 파일·폴더 복사 단계를 관리합니다. |
| C++ 편집·디버깅 | Microsoft C/C++와 연결해 IntelliSense, 선언·정의 이동, 참조 검색과 디버깅을 제공합니다. Qt 4.8.1용 Qt 변수 표시기를 포함합니다. |
| CMake | Configure, Build, Clean을 실행하고 CMake File API의 소스·실행 대상·컴파일 정보를 사용합니다. |
| Codex 제어 | 로컬 API로 프로젝트 선택, 빌드, 중단점, 스택·변수 조회와 디버거 조작을 제공합니다. |

북마크와 최근 프로젝트도 개인 저장소에 유지합니다. 프로젝트에 `.vscode`, `.qtide`, `.code-workspace` 설정 파일을 만들지 않습니다.

## 지원 환경

| 항목 | 요구 사항·범위 |
| --- | --- |
| 운영체제 | Windows |
| 편집기 | VS Code 1.100 이상 |
| 필수 확장 | Microsoft C/C++ (`ms-vscode.cpptools`) |
| qmake 프로젝트 | Windows MinGW. Qt 4.8.1 / 구형 MinGW 32비트, Qt 5.15.19 / MinGW 8.1 32·64비트, Qt 6.11.0 / MinGW 13.1 64비트 설치를 자동 발견합니다. 다른 설치 경로는 키트 설정에서 지정할 수 있습니다. |
| CMake 프로젝트 | CMake File API는 CMake 3.14 이상, 컴파일러 자동 조회는 3.20 이상. GDB 또는 MSVC 디버거를 사용합니다. Ninja/NMake + MSVC의 개발 환경은 키트 환경변수에 직접 지정해야 합니다. |

Qt, CMake, 컴파일러는 별도로 설치해야 합니다. Qt Extension Pack은 필요하지 않습니다. UI 디자이너와 Qt Creator 수준의 코드 모델은 포함하지 않습니다.

## 설치

이 확장은 개인용 VSIX로 설치하며 Marketplace에 게시하지 않습니다.

1. 설치할 `.vsix` 패키지를 준비합니다. 소스에서 만들려면 아래 [개발·패키징](#개발패키징)을 참고하세요.
2. VS Code에서 **Ctrl+Shift+X → ⋯ → VSIX에서 설치…**를 선택합니다.
3. 패키지를 지정하고, Microsoft C/C++ 확장이 없으면 함께 설치합니다.
4. **Developer: Reload Window**로 창을 다시 불러옵니다. 업데이트 후에도 한 번 실행하세요.

Windows에서 `.vsix`를 더블클릭하면 Visual Studio용 설치 관리자가 열릴 수 있으므로 VS Code 안에서 설치하세요. 오프라인 PC에서는 해당 VS Code 버전과 Windows 아키텍처에 맞는 Microsoft C/C++ VSIX를 먼저 설치해야 합니다.

## 빠른 시작

1. **프로젝트 열기** — `Ctrl+Shift+P` → **Qt Pro: Open Project (.pro)**를 실행합니다. `.pro`를 편집기로 열어도 자동 등록됩니다. CMake는 **Qt Projects의 + → CMakeLists.txt**로 엽니다.
2. **키트 선택** — 하단 **프로젝트 이름 ▾** → **Project Settings → Project / Kit**에서 선택합니다. 키트가 없으면 **키트 관리…**에서 자동 검색하거나 경로를 지정하세요.
3. **빌드 구성 선택** — 하단 **Debug / Release ▾**에서 구성을 선택합니다. 인수나 빌드 폴더는 **Build Settings**에서 지정합니다.
4. **빌드** — 하단 **빌드** 버튼 또는 **Ctrl+Shift+B**를 누릅니다.
5. **실행·디버깅** — 하단 **▶ / Ctrl+F5**로 실행하거나 **F5**로 디버깅합니다. 실행 파일·인수·작업 폴더는 **Run Settings**에서 지정합니다.

실행과 F5는 활성 프로젝트의 **Build → Deploy → 실행 또는 디버깅** 순서로 동작합니다. 배포 단계를 등록하지 않았다면 복사 작업 없이 진행합니다. 변경이 없으면 빌드 도구가 재컴파일을 건너뛰며, 빌드가 실패하면 실행하지 않습니다.

기존 디버그 구성이 있는 경우 VS Code의 **실행 및 디버그** 목록에서 **Qt Pro: 활성 프로젝트**를 선택하세요. F5는 현재 선택한 Debug/Release 구성을 사용하므로, 소스 중단점을 사용하려면 실행 파일에 해당 소스의 디버그 심벌이 있어야 합니다.

## 알아두면 좋은 동작

- **빌드 대상:** 하단 버튼과 명령 팔레트는 활성 프로젝트를 사용합니다. `.pro` 우클릭 명령은 우클릭한 프로젝트를 대상으로 하며, 파일을 편집하거나 하위 프로젝트를 빌드해도 활성 프로젝트가 바뀌지 않습니다.
- **빌드 위치:** qmake의 Shadow build는 기본적으로 꺼져 있어 `.pro` 폴더에서 빌드합니다. CMake는 기본적으로 `%LOCALAPPDATA%/QtProWorkbench/cmake-builds` 아래 별도 폴더를 사용합니다. 개인 설정의 저장 위치와 빌드 산출물의 위치는 별개입니다.
- **프로젝트 트리:** qmake 파일을 정적으로 읽습니다. 사용자 함수·반복문·복잡한 치환으로 만든 파일 목록은 누락될 수 있으며 **Qt Pro: Show Project Parsing Notes**에서 확인할 수 있습니다. 실제 빌드는 qmake가 처리합니다.
- **참조 검색:** 폴더 없이 연 프로젝트는 최초 검색 때 현재 창에 분석 폴더를 추가하고 확장 호스트를 다시 시작합니다. 열린 프로젝트와 저장하지 않은 파일 내용은 복원됩니다. 활성 디버그 세션이 있으면 종료한 뒤 최초 검색을 실행하세요.
- **사용자 설정:** C/C++의 configuration provider와 공용 디버그 진입점을 사용자 설정에 등록합니다. 이전 provider는 **Qt Pro: Restore Previous C/C++ Provider**로 복원할 수 있습니다.

자세한 명령, 설정 항목과 Qt 4 디버깅 동작은 [사용 가이드](docs/USAGE.md)를 참고하세요.

## Codex에서 사용

설치 후 창을 다시 불러오면 로컬 제어 스크립트와 `vscode-qt-control` 스킬이 설치됩니다. 기존 동명 사용자 스킬은 덮어쓰지 않습니다.

Codex에서 **$vscode-qt-control**을 지정하거나, `%LOCALAPPDATA%/QtProWorkbench/control-api/QtControl.ps1`의 `qt_list_instances`와 `help`로 시작하세요. 프로젝트·키트 선택, 빌드, 중단점 설정, 변수 조회와 단계 실행을 제어할 수 있습니다.

호출 예제는 [CODEX-CONTROL.md](https://github.com/linehad/qt-pro-workbench/blob/HEAD/CODEX-CONTROL.md)에 있습니다.

## 개발·패키징

Node.js 22 이상과 PowerShell 7이 필요합니다. 저장소 루트에서 실행하세요.

```powershell
npm ci
npm test
pwsh -NoProfile -File ./Package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./test/Test-VsixPackage.ps1 -PackagePath ./qt-pro-workbench-0.12.4.vsix
```

`Package.ps1`은 `package.json`의 버전으로 VSIX를 생성합니다. 마지막 명령의 파일명은 생성된 패키지 버전에 맞추세요. 패키지 검증은 .NET 판독기로 콘텐츠 형식, 필수 파일, 설치 대상과 버전 일치를 확인합니다.

`npm test`는 TypeScript 컴파일과 단위 테스트를 실행합니다. `test/*integration.cjs`는 별도 VS Code 시험 창에서 실행하는 통합 검증입니다. 일부는 개발 PC의 Qt SDK나 프로젝트 경로에 의존하므로, 해당 환경에 맞춰 경로를 지정한 뒤 필요한 검증을 실행하세요.

npm 런타임 패키지는 사용하지 않습니다. Git에는 소스·리소스·테스트·설정·문서를 포함하고, `node_modules/`, `out/`, VSIX와 생성된 테스트 결과·개인 프로필은 제외합니다.

## 문서·라이선스

- [사용 가이드](docs/USAGE.md): 프로젝트 탐색, 키트, 빌드·배포·실행, 디버깅과 개인 설정
- [Codex 제어 가이드](https://github.com/linehad/qt-pro-workbench/blob/HEAD/CODEX-CONTROL.md): 로컬 API와 호출 예제
- [MIT 라이선스](https://github.com/linehad/qt-pro-workbench/blob/HEAD/LICENSE)
