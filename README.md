# Qt Pro Workbench (Local)

개인용 VS Code 확장입니다. 폴더를 열지 않고 `.pro`를 열어 프로젝트 파일 트리, Qt/컴파일러 키트 선택, 빌드·실행·디버깅을 사용할 수 있습니다.

설치할 때는 **VS Code 1.100 이상**에서 **Ctrl+Shift+X → ⋯ → VSIX에서 설치…**를 선택한 뒤 패키지를 지정하세요. Windows에서 `.vsix`를 더블클릭하면 Visual Studio용 설치 관리자가 열릴 수 있습니다. Microsoft C/C++ 확장이 없으면 의존 확장 설치가 필요하며, 인터넷에 연결할 수 없는 PC에서는 해당 PC의 VS Code 버전과 Windows 아키텍처에 맞는 C/C++ VSIX를 먼저 설치하세요.

## 사용

1. `Ctrl+Shift+P` → **Qt Pro: Open Project (.pro)**. `.pro`를 편집기로 열어도 자동 등록됩니다.
2. 왼쪽 **Qt Projects** 아이콘에서 프로젝트를 선택합니다. 하위 프로젝트도 선택할 수 있습니다.
   아이콘은 네모들이 연결된 모양입니다. Qt Creator처럼 프로젝트 파일을 맨 위에 표시하고, `include()`한 `.pri`를 각각 별도 하위 노드로 표시합니다. 각 `.pri` 아래에는 해당 파일, 중첩된 `.pri`, 그리고 그 파일에서 선언한 Headers/Sources/Forms 등의 분류가 표시됩니다. 각 분류 안은 실제 폴더 계층이며, 외부 참조 파일은 `..` 폴더 아래로 묶습니다.
3. 하단 **프로젝트명.pro ▾**를 눌러 Project Settings를 열고 **Project / Kit**를 선택합니다.
4. 하단 **Debug / Release ▾**를 누르면 빌드 구성 목록이 열립니다. 현재 구성을 표시하며 다른 항목을 선택하면 바로 전환합니다. 직접 추가한 빌드 구성도 같은 목록에 표시됩니다. 상세 설정은 **프로젝트명.pro ▾ → Build Settings**에서 편집합니다.
5. 하단 **프로젝트명.pro 빌드** 버튼으로 활성 프로젝트를 빌드하고, **▶**로 실행하며 그 옆 디버그 버튼이나 **F5**로 디버깅합니다. 키트 설정은 통합 화면의 **키트 관리…**에서 엽니다. 실행·디버그 전에는 일반 make를 호출하며, 변경된 파일이 있을 때만 컴파일합니다. 특정 프로젝트를 대상으로 작업하려면 해당 `.pro` 파일을 우클릭합니다.

상단에는 **+ · 프로젝트 추가**, **현재 파일 따라가기**, **새로고침**만 남깁니다. **+**는 어떤 파일을 편집 중이든 `.pro` 선택 창을 엽니다. 프로젝트·키트·Debug/Release 선택과 빌드·실행·디버그는 하단 상태 표시줄에 모았습니다.

## 선언·정의 이동

C++에서는 **F12 / Ctrl+클릭**으로 정의를 찾습니다. 이미 그 정의에 있으면 선언으로 이동하며, 헤더의 선언에서 누르면 구현으로 돌아갑니다. **Shift+F12**는 참조 목록, **Alt+←**는 이동 전 위치로 돌아가기입니다. **Alt+F12**는 정의 미리 보기입니다.

이 확장은 C++의 `editor.gotoLocation.alternativeDefinitionCommand` 기본값을 `editor.action.revealDeclaration`, 선언 이동의 반대 방향을 `editor.action.revealDefinition`으로 제공합니다. 사용자 설정에서 직접 지정한 값은 우선합니다. 실제 정의나 선언 후보가 여러 개이면 VS Code가 후보 목록을 표시합니다.

## 열린 프로젝트에서 참조 검색

**Shift+F12 / Shift+Alt+F12**, 또는 편집기 우클릭의 **Qt Pro: 모든 참조 찾기 (열린 프로젝트)**를 사용합니다. VS Code C/C++의 의미 분석 결과를 **References** 사이드바에 표시합니다. 현재 파일이 속한 저장소 루트의 열린 `.pro` / CMake 프로젝트와 하위 프로젝트만 포함합니다. 같은 루트의 다른 열린 프로젝트에서 호출하면 함께 표시하고, 닫힌 프로젝트와 다른 루트의 동일한 파일·함수는 제외합니다. 루트는 가장 가까운 `.git` / `.svn` / `.hg` 폴더이며 표시가 없으면 프로젝트 폴더를 사용합니다.

폴더 없이 `.pro`만 연 창은 최초 참조 검색 때 **현재 창에 분석 폴더를 추가**합니다. 새 VS Code 창을 열지 않습니다. 최초 폴더 추가로 확장 호스트가 다시 시작되지만 열린 프로젝트, 활성 프로젝트와 저장하지 않은 파일 내용은 유지합니다. C/C++ 확장의 전체 소스 색인이 작업 공간 폴더를 요구하기 때문입니다. 복원 정보는 개인 저장소에 보관하고 프로젝트 안에는 분석 설정 파일을 만들지 않습니다. 이후 다른 루트의 프로젝트를 열면 필요한 분석 폴더를 추가합니다. 처음 색인을 준비하는 동안 활성 디버그 세션은 종료하지 않으며, 그 경우 디버깅을 마친 뒤 최초 참조 검색을 실행하도록 안내합니다.

명령 팔레트 또는 편집기 우클릭의 **Qt Pro: 열린 프로젝트에서 이름 검색**은 입력한 이름을 문자 그대로 검색합니다. 이 명령은 루트가 달라도 열린 프로젝트 전체를 포함합니다. VS Code 기본 참조 메뉴와 별도로, 위 Qt Pro 명령과 단축키에 프로젝트 범위 제한이 적용됩니다.

## 현재 파일 따라가기와 북마크

Qt Projects는 편집 중인 파일의 상위 폴더를 펼쳐 해당 파일 행을 자동 선택합니다. 편집기 포커스와 활성 빌드·실행 프로젝트는 유지합니다. 같은 파일이 여러 프로젝트에서 참조되면 현재 선택한 트리 분기를 우선합니다. Qt Projects를 숨겨 둔 동안 다른 사이드바를 강제로 열지 않고, 다시 표시할 때 현재 파일을 선택합니다.

- Qt Projects 상단 **연결 고리 아이콘 · 현재 파일 자동 선택**으로 켜고 끕니다. 기본값은 켜짐입니다.
- 명령 팔레트의 **Qt Pro: Reveal Current File in Qt Projects**로 직접 찾을 수도 있습니다.
- 줄 번호 우클릭 → **Toggle Bookmark**, 또는 **Ctrl+Alt+K**로 북마크를 추가·해제합니다. 마우스로 우클릭한 줄을 기준으로 하며 중단점과는 별개입니다.
- Qt Projects 아래 **Bookmarks**에서 파일별 북마크를 보고 클릭해서 이동합니다. **Ctrl+Alt+L**은 다음, **Ctrl+Alt+J**는 이전 북마크이며 마지막에서 처음으로 순환합니다.
- 목록에서 북마크 우클릭 → **Rename Bookmark**로 이름을 붙이고, **×**로 삭제합니다. 파일 행의 **×**는 그 파일의 북마크만 제거합니다.
- 편집 중 줄 삽입·삭제에 따라 북마크 위치를 갱신합니다. 북마크가 있던 줄 전체를 삭제하면 해당 북마크도 제거됩니다. VS Code에서 파일을 이름 변경하면 북마크 경로도 갱신합니다.

북마크는 개인 저장소의 `bookmarks.json`에 저장되어 VS Code를 다시 열어도 유지됩니다. 프로젝트에 북마크 설정 파일을 만들지 않습니다.

## 키트 설정 화면

Project Settings의 **키트 관리…** 또는 명령 팔레트의 **Qt Pro: Kit Settings (키트 설정)**을 누릅니다. 프로젝트를 열지 않아도 설정할 수 있습니다. 프로젝트의 키트 선택 목록 아래 **키트 설정…**으로도 열 수 있습니다.

- 왼쪽 목록에서 키트를 선택하고 이름, Qt의 `qmake.exe`, MinGW의 `bin` 폴더, `mingw32-make.exe`, GDB 경로, qmake spec을 수정합니다. 경로는 **찾아보기…**로 선택할 수 있습니다.
- **추가**, **복제**, **삭제**로 키트 목록을 편집합니다. 변경은 **저장**할 때 적용됩니다. 기존 키트의 이름이나 경로를 바꿔도 그 키트를 선택한 프로젝트와 실행 설정의 연결은 유지됩니다.
- **설치된 Qt 자동 찾기**는 이 PC의 지원되는 Qt/MinGW 설치를 목록에 추가합니다. 같은 qmake 경로의 기존 설정은 덮어쓰지 않습니다.
- **추가 설정**의 qmake 인수는 하나당 한 줄이며 공백을 따옴표로 감싸지 않습니다. make 인수는 `-j8` 또는 `-j 8`처럼 한 줄로 입력합니다. 공백을 포함한 인수는 큰따옴표로 감쌉니다. make 인수를 비우면 실제 CPU 수에 맞춘 `-jN`을 사용합니다. 환경변수는 `NAME=value`를 한 줄씩 입력합니다.
- 디버거를 비우면 표시된 기본 GDB를 사용합니다. 컴파일러는 해당 Qt 버전·아키텍처와 호환되는 것을 선택하세요. 현재 지원하는 구성은 Windows MinGW입니다.
- 저장한 키트는 모든 프로젝트에서 공유합니다. 사용할 프로젝트에서 **Select Qt / Compiler Kit**로 선택하세요. JSON 파일을 직접 편집할 필요가 없습니다.

설치 후 첫 실행에서 Qt Creator 설정을 **최초 한 번만** 가져옵니다. `C:/Qt/Tools/sdktool/share/qtcreator/QtProject/qtcreator`, QtCreator의 공유 설정과 `%APPDATA%/QtProject/qtcreator`에서 Desktop 키트의 Qt, C/C++ 컴파일러, make, GDB와 CMake/Generator 연결을 읽습니다. 사용자 설정을 SDK 기본 설정보다 우선합니다. 새 설치는 Creator 설정을 기본값으로 사용하고, 이미 저장된 키트는 ID·이름·직접 편집한 값을 보존하면서 빠진 기본값만 보완합니다. `qt-creator-import.json`에 처리 여부를 기록하며 다음 실행부터는 다시 읽거나 덮어쓰지 않습니다. Qt Creator 설정 파일 자체는 수정하지 않습니다.

## Clean / qmake / Build / Rebuild

`.pro` 파일 우클릭 메뉴와 명령 팔레트에 각각 독립 명령이 있습니다. Qt Projects의 프로젝트 폴더 행에는 빌드 메뉴를 표시하지 않습니다. 기본 탐색기의 `.pro` 파일과 편집기 탭의 우클릭 메뉴에서도 사용할 수 있습니다.

우클릭 메뉴와 하단 **빌드** 버튼 옆 **⌄** 메뉴가 동일한 명령을 사용합니다. 하단 버튼에는 빌드 대상 `.pro` 이름을 표시하고, 마우스를 올리면 키트·Debug/Release·전체 경로를 볼 수 있습니다. 하단 **⌄**에서 Build / Run qmake / Clean / Rebuild를 선택합니다. Qt 프로젝트가 활성화된 동안 **Ctrl+Shift+B**도 같은 Build 명령을 실행합니다.

우클릭 메뉴는 현재 활성 프로젝트와 관계없이 **우클릭한 `.pro` 파일**을 대상으로 합니다. 상위 `.pro`를 선택하면 상위 프로젝트를 빌드하고, `SUBDIRS`에 포함된 프로젝트는 해당 qmake 규칙에 따라 빌드됩니다. 하위 `.pro`를 선택하면 그 프로젝트의 키트·Debug/Release 구성과 빌드 설정을 사용합니다. Build, qmake, Clean, Rebuild 모두 같은 대상 선택 규칙을 따릅니다. 명령 팔레트와 하단 버튼처럼 파일을 지정하지 않는 명령은 활성 프로젝트를 사용합니다.

| 명령 | 수행 단계 |
| --- | --- |
| Build Project | 선택한 프로젝트·Qt·구성과 일치하는 Makefile이 있으면 make만 실행합니다. 없거나 다른 Qt의 Makefile이면 qmake로 생성한 뒤 make를 실행합니다. |
| Run qmake | Makefile을 생성·갱신합니다. 컴파일하거나 실행하지 않습니다. |
| Clean Project | 기존 Makefile의 `make clean`을 실행합니다. Makefile이 없으면 정리할 내용이 없다고 안내합니다. |
| Rebuild Project | 기존 Makefile이 있으면 Clean, 이어서 qmake → Build. 중간 단계가 실패하면 멈춥니다. |

같은 프로젝트에서는 어떤 진입점을 사용해도 선택한 키트·Debug/Release, 빌드 폴더, make 인수, 환경변수가 같습니다. Clean이 지우는 항목은 프로젝트의 Makefile 규칙을 따릅니다. 별도로 지정한 실행 EXE 경로를 삭제하는 기능은 아닙니다. Run 및 F5의 실행 전 빌드도 일반 Build와 같은 처리를 사용합니다. Makefile 자체의 의존성 규칙에 따른 qmake 재실행은 make가 판단합니다.

## 빌드 설정 화면

`.pro` 파일 우클릭 → **Qt Pro: Build Settings (빌드 설정)**에서 설정합니다. 이 확장이 자체적으로 관리하며 Qt Creator의 설치나 설정 파일을 사용하지 않습니다.

- **Shadow build는 기본적으로 꺼져 있습니다.** 끈 상태에서는 해당 `.pro` 파일이 있는 폴더에서 빌드합니다. 켠 경우에만 지정한 별도 폴더에서 빌드합니다.
- qmake 추가 인수, make 인수, clean 인수와 환경변수를 프로젝트·키트·Debug/Release별로 저장합니다. 기본 make는 CPU 수에 따른 `-jN`, clean은 `clean -jN`입니다. qmake 인수·빌드 환경을 바꾸면 다음 빌드에서 qmake를 한 번 실행해 Makefile을 갱신합니다. make 인수만 바꾸거나 같은 옵션으로 Debug/Release를 전환하면 기존 Makefile을 재사용합니다. **Run qmake**로 직접 갱신할 수도 있습니다.
- `DESTDIR`, `OBJECTS_DIR`, `MOC_DIR`, `RCC_DIR`, `UI_DIR`는 `.pro/.pri`의 규칙을 그대로 따릅니다. 확장이 별도 `bin`, `obj`, `moc` 경로로 덮어쓰지 않습니다.
- 같은 도구·옵션·폴더에서 만든 기존 Makefile, `.o`, moc, EXE를 재사용합니다. Debug는 `Makefile.Debug`, Release는 `Makefile.Release`가 있으면 해당 파일을 사용합니다. 변경이 없으면 make가 컴파일·링크를 건너뜁니다.
- **Add / Remove / Rename / Clone**으로 이름별 빌드 구성을 관리합니다. 각 구성의 Debug/Release 종류와 빌드 설정을 독립적으로 저장합니다. 기존 Debug/Release 설정을 그대로 불러옵니다.
- 빌드 구성은 프로젝트 밖의 개인 저장소 `build-profiles/`에 저장됩니다. 이전 `build-configurations/` 설정도 읽습니다. 실행·배포 구성은 같은 프로젝트·키트·Debug/Release 종류끼리 공유합니다.

## 실행 설정: 여러 실행 프로그램 관리

Qt Projects에서 `.pro` 파일 우클릭 → **Qt Pro: Run Settings**, 또는 명령 팔레트에서 같은 명령을 실행합니다. 선택한 `.pro`의 키트·Debug/Release에 대한 설정 화면이 열립니다. 값을 바꾼 뒤 **저장**을 누르세요. **Active run configuration**에서 선택한 설정을 Run과 F5가 함께 사용합니다.

- **Add… → Custom Executable**: 기존 설정을 남겨 둔 채 다른 EXE의 실행 설정을 추가합니다. 새 항목의 Executable, 인수, 작업 폴더를 입력하고 저장하세요.
- **Add… → 프로젝트 출력**: Makefile의 출력 경로를 따르는 실행 설정을 추가합니다.
- **Rename… / Clone… / Remove**: 설정 이름 변경, 독립된 복사본 추가, 선택한 설정 삭제입니다. 실행 설정은 하나 이상 유지합니다. EXE 파일 자체는 삭제하지 않습니다.
- 설정을 전환하거나 추가·복제할 때 현재 입력값도 저장합니다. 인수의 빈칸도 그대로 보존합니다.
- 기존 버전의 실행 경로·인수·작업 폴더는 첫 번째 실행 설정으로 유지합니다. 설정 목록과 선택은 프로젝트·키트·Debug/Release별로 독립적입니다.

| 항목 | 동작 |
| --- | --- |
| Executable | **프로젝트 출력** 설정은 Makefile의 출력 EXE 경로가 기본값이며, 비우면 그 경로를 따릅니다. **Custom Executable**은 직접 지정한 EXE를 사용하며 빈칸이면 실행하지 않고 경로 입력을 안내합니다. 별도 배포 폴더의 EXE도 지정할 수 있습니다. |
| Command line arguments | `Run`, `--mode "test run"`처럼 입력합니다. 빈칸으로 저장하면 인수를 주지 않습니다. `""`는 빈 문자열 인수 하나입니다. |
| Working directory | 프로그램이 상대 경로를 해석할 기준 폴더입니다. 빈칸은 EXE가 있는 폴더입니다. |

예: Executable에 `F:\1.4.13_Work\Build_OUTPUT_HMI\debug\HydraX.exe`, 인수에 `Run`, 작업 폴더는 빈칸으로 지정할 수 있습니다. 인수가 필요 없는 프로젝트는 빈칸으로 저장하세요. Deploy Settings에 복사 단계를 등록하면 실행·디버그 전에 배포 폴더의 EXE와 DLL을 갱신합니다. 복사 단계를 등록하지 않은 외부 EXE는 기존 위치에서 그대로 실행합니다.

실행·디버그 전에 빌드 여부를 묻거나 별도로 변경을 검사하지 않습니다. Makefile이 없거나 키트·qmake 설정이 달라졌으면 qmake를 실행하고, 이후 일반 make가 변경된 파일만 빌드합니다. 변경이 없으면 컴파일·링크 없이 실행으로 이어집니다.

실행과 디버깅에 동일한 인수·작업 폴더를 전달합니다. **F5 / Debug Project도 현재 선택한 Debug 또는 Release 구성의 설정을 사용**합니다. Release를 Debug로 강제 전환하지 않습니다. 소스 중단점을 사용하려면 해당 소스에 대응하는 디버그 심벌을 가진 EXE가 필요합니다.

Run은 프로그램의 GUI 창 표시를 허용합니다. qmake·make 같은 빌드 도구에는 별도 Windows 창을 숨기는 옵션을 사용하지만, 실행 EXE에는 이 옵션을 적용하지 않습니다.

경로에는 `${projectDir}`, `${buildDir}`를 사용할 수 있습니다. 작업 폴더에는 `${executableDir}` 및 Qt Creator의 `%{RunConfig:Executable:Path}`도 사용할 수 있습니다. 상대 경로는 `.pro` 폴더 기준이며, 셸 명령이나 환경변수 치환은 실행하지 않습니다. 설정은 프로젝트 경로·키트·Debug/Release별로 따로 유지되고, 브랜치를 바꿔도 남습니다. 프로젝트 안에 설정 파일을 생성하지 않습니다.

실행 설정은 확장의 개인 저장소 `run-configurations/` 아래에 프로젝트별 JSON으로 저장합니다. 화면의 저장이 끝나면 다음 실행·디버깅에 바로 적용됩니다.

## Deploy Settings

기본 구성은 **Deploy Configuration**, 기본 단계는 **No Deploy Steps**입니다. Add / Remove / Rename / Clone으로 배포 구성을 관리합니다. **Add Deploy Step · 파일·폴더 복사**로 원본과 대상 폴더를 지정합니다. 원본 파일·폴더의 이름을 유지해 대상 폴더 안에 복사하며 하위 폴더와 빈 폴더도 보존합니다. 상대 경로는 `.pro` 폴더 기준입니다.

- `${projectDir}`, `${buildDir}`, `${configuration}`을 사용할 수 있습니다. `${executable}`과 `${outputDir}`는 프로젝트가 빌드한 EXE와 출력 폴더입니다. 실행 파일이 여러 개면 직접 경로를 지정하세요.
- 배포 구성을 저장하면 **Run / F5가 Build → Deploy → 실행** 순서로 처리합니다. 하단 빌드 작업 메뉴의 **Deploy** 및 `.pro` 우클릭의 **Deploy Project**는 Build → Deploy만 실행합니다.
- 모든 원본과 대상 경로를 복사 전에 확인합니다. 없는 원본, 중복 대상, 원본 폴더 내부로의 복사, 링크 경로는 오류로 중단합니다. 복사가 실패하면 실행하지 않습니다.
- 파일 내용이 같으면 덮어쓰지 않으므로 EXE·DLL의 불필요한 재복사를 줄입니다. 파일을 삭제하거나 원본과 대상 폴더 전체를 동기화하는 기능은 아닙니다.
- 구성과 활성 선택은 개인 저장소 `deploy-configurations/`에 프로젝트·키트·Debug/Release별로 보관합니다. 프로젝트 안에 설정 JSON을 만들지 않습니다.

Run Settings의 **Environment**는 빌드 환경에 `NAME=value`를 추가합니다. **Debugger Settings**에는 선택한 키트의 GDB 경로와 추가 시작 명령을 표시합니다. 시작 명령은 F5에서 한 줄씩 적용합니다. **Run in terminal**을 켜면 Run 작업 터미널을 표시하며, 끄면 GUI 실행을 허용하면서 실행 터미널을 자동으로 열지 않습니다. F5에서는 별도 콘솔 사용 여부에 적용합니다. C++/GDB를 지원하며 QML·Python 디버거 설정은 제공하지 않습니다.

## 기본 실행 및 디버그 / F5

Qt 프로젝트가 활성화되어 있으면 `.cpp`, 헤더 등 어떤 파일을 편집 중이든 **F5**로 현재 선택한 구성의 **빌드 → 성공 시 실행**을 시작합니다. 변경한 파일을 저장하고 일반 make를 실행한 뒤, 선택한 키트의 GDB와 Microsoft C/C++ 디버거로 실행합니다. 변경이 없으면 재컴파일 없이 실행하고, 빌드가 실패하면 이전 EXE를 실행하지 않습니다. 디버깅 중 F5는 기존의 계속 실행 기능을 유지합니다.

왼쪽 VS Code 기본 **실행 및 디버그** 버튼과 실행 메뉴의 **디버깅 시작**도 같은 빌드·디버그 흐름을 사용합니다. 파일을 열지 않았거나 `.cpp`를 편집 중이어도 활성 Qt 프로젝트를 실행합니다. 확장이 VS Code 사용자 설정에 **Qt Pro: 활성 프로젝트**라는 공용 디버그 진입점을 등록하며, 실제 프로젝트·키트·Debug/Release·Run 설정은 실행할 때마다 현재 선택을 따릅니다. 기존 디버그 구성이 있으면 목록에서 **Qt Pro: 활성 프로젝트**를 선택하세요. 다른 사용자 디버그 설정은 보존하며 프로젝트에 `launch.json`을 만들지 않습니다. [VS Code 사용자 디버그 구성](https://code.visualstudio.com/docs/debugtest/debugging-configuration#_global-launch-configuration)을 사용합니다.

`.pro`의 언어 모드는 **Qt qmake**로 표시됩니다. 확장을 업데이트한 기존 창은 **Developer: Reload Window**로 한 번 다시 불러오세요. 실행만 하려면 하단 **▶**, **Ctrl+F5** 또는 **Qt Pro: Run Project**를 사용합니다. 활성 Qt 프로젝트가 있고 디버깅 중이 아닐 때 Ctrl+F5는 하단 실행 버튼과 같은 명령을 사용합니다. 키트의 GDB 경로가 별도라면 **Kit Settings**의 **디버거 · GDB**에서 지정할 수 있습니다.

Qt 4.8.1은 QtSDK에 포함된 **GDB 7.2**를 기본으로 사용합니다. 이 PC에서는 `C:/QtSDK/pythongdb/python_2.7based/gdb-i686-pc-mingw32.exe`이며, 선택한 MinGW `bin` 폴더를 기준으로 QtSDK의 디버거 경로를 계산하므로 설치 드라이브가 달라도 따라갑니다. 키트 설정에서 GDB를 직접 지정한 경우 그 경로를 우선합니다. 컴파일러와 런타임은 QtSDK의 기존 32비트 도구를 그대로 사용합니다. Windows의 `Path` 환경변수 이름을 보존하여 Qt DLL을 찾도록 전달합니다.

디버깅 보조 파일과 Qt 변수 표시기는 `%LOCALAPPDATA%/QtProWorkbench/debug-runtime/`의 내용별 디렉터리에 보관합니다. VSIX 업데이트로 이전 확장 버전 폴더가 삭제되어도 이미 생성한 실행 경로가 남습니다. 업데이트 후 기존 창은 **Developer: Reload Window**로 새 코드를 불러오세요.

Qt 4.8.1 디버그 세션에는 확장에 포함된 **Qt 변수 표시기**를 자동으로 등록합니다. Qt Creator 설치나 별도 Python 설치는 필요하지 않으며 QtSDK GDB 7.2에 내장된 Python 2.7을 사용합니다. **QString / QStringRef / QChar / QByteArray**, **QStringList / QList / QVector / QQueue / QStack**, **QMap / QMultiMap / QHash / QMultiHash**, 기본 **QVariant** 값을 지원합니다. 호버·조사식·지역 변수에서 문자열과 숫자를 표시하고 컨테이너를 펼치면 내부 관리 포인터 대신 원소나 키·값이 나옵니다. GDB 7.2의 컨테이너 요약은 `{...}`이며 원소는 펼쳐 확인합니다. 중첩 컨테이너와 QVariant의 문자열·숫자·리스트·맵을 지원하지만 Qt Creator의 모든 Qt 타입 표시기를 제공하는 것은 아닙니다.

한글·이모지를 위해 디버거의 문자 인코딩을 UTF-8로 설정합니다. 일반 `char*` 문자열도 UTF-8 기준으로 해석되며 CP949 바이트 문자열은 다른 인코딩을 지정해 확인해야 합니다. Qt 문자열은 UTF-16 메모리를 직접 읽고 QByteArray는 바이너리 바이트를 보존해 표시합니다. 읽을 수 없는 데이터나 누락된 타입 심벌은 값을 추측하지 않고 오류로 표시합니다. 업데이트 후 **Developer: Reload Window**를 한 번 실행하고 현재 디버깅을 종료한 뒤 F5로 새 세션을 시작하세요.

## Codex에서 프로젝트·디버거 제어

VS Code 공식 API와 로컬 파이프로 프로젝트·키트·빌드/실행 구성 선택, 중단점 추가·제거, 스택·지역 변수·Qt 값 조회, 계속 실행·Step In/Out·한 줄 실행·일시 중지·종료를 제공합니다. MCP 설정은 사용하지 않습니다. 설치 후 **Reload Window**를 실행하면 `%LOCALAPPDATA%/QtProWorkbench/control-api/QtControl.ps1` 호출 스크립트가 자동 설치됩니다. Codex에서 해당 스크립트의 `qt_list_instances`와 `help`를 먼저 호출하세요. 창과 디버그 세션 ID를 명시하므로 다른 프로젝트나 창으로 요청을 자동 전환하지 않습니다. 상세 호출 예제는 [CODEX-CONTROL.md](CODEX-CONTROL.md)와 **Qt Pro: Codex Control Guide** 명령에서 볼 수 있습니다.

**vscode-qt-control** 스킬 하나를 개인 스킬 폴더에 설치합니다. **$vscode-qt-control**로 지정하거나 관련 요청에 자동 적용할 수 있습니다. `SKILL.md`가 작업에 따라 프로젝트·빌드, 디버깅, VS Code 조작, 참조·Qt Pro 설정, 문제 해결의 안내 MD를 골라 읽도록 지시합니다. 기존 동명 사용자 스킬은 덮어쓰지 않고, 사용자가 편집한 UI 메타데이터와 자동 적용 설정은 유지합니다. 이전에 자동 설치한 두 관리 스킬은 스킬 검색 경로 밖의 `skill-backups/`에 보관하고 통합 스킬만 등록합니다.

Qt 4.8.1의 제어 API는 일시 중지 요청에 32비트 Windows 디버그 중단을 사용합니다. 대상 PID의 실행 경로와 실제 디버거 연결을 확인하고 그 프로세스에만 적용합니다. 나머지 제어와 변수 표시는 VS Code의 C/C++ 디버거 API를 사용합니다.

## Qt 헤더와 IntelliSense

키트를 선택하면 Microsoft C/C++에 해당 Qt의 헤더 경로, 프로젝트 include 경로, 컴파일러와 비트 수를 전달합니다. 최초 빌드 전에는 정적 프로젝트 정보와 Qt 설치 경로를 사용하고, 빌드 후에는 생성된 Makefile의 include/define/컴파일 옵션을 적용합니다. 키트 변경 시 헤더 경로도 바뀝니다. 조건문 안의 프로젝트 설정은 첫 빌드 전에는 합쳐서 해석될 수 있습니다.

분석 설정은 열린 모든 프로젝트와 `SUBDIRS`의 하위 `.pro`에 파일별로 제공합니다. 별도 키트를 지정하지 않은 하위 프로젝트는 상위 프로젝트의 키트·구성과 빌드 폴더를 따릅니다. 다른 프로젝트의 파일을 열어도 활성 빌드·실행 대상을 바꾸지 않습니다. 같은 파일을 여러 프로젝트가 공유하면 활성 프로젝트의 설정을 우선합니다.

트리에 등록하지 않은 프로젝트의 파일도 상위 폴더에서 파일을 포함하는 `.pro`를 찾고, 그 프로젝트에 저장된 키트가 있으면 분석 설정을 제공합니다. 파일을 편집한다고 그 프로젝트를 빌드 대상으로 자동 선택하지는 않습니다.

사용자 설정 `C_Cpp.default.configurationProvider`를 `ynlim.qt-pro-workbench`로 지정합니다. 이전 사용자 값은 확장의 개인 저장소에 보관하며 **Qt Pro: Restore Previous C/C++ Provider**로 복원할 수 있습니다. 프로젝트 안에 `c_cpp_properties.json`은 만들지 않습니다.

**Qt Pro: Open Recent Project**로 다른 경로의 프로젝트를 다시 열 수 있습니다. 등록을 없애려면 프로젝트 우클릭 → **Close Project**. 실제 파일은 삭제하지 않습니다.

## 개인 설정과 빌드

- 설정, 최근 프로젝트, 키트 선택은 VS Code 사용자 데이터에만 저장합니다. `.vscode`, `.qtide`, `.code-workspace`를 프로젝트에 만들지 않습니다.
- 키트 파일과 개인 빌드·실행 설정은 `%APPDATA%/Code/User/globalStorage/ynlim.qt-pro-workbench/` 아래입니다. 프로젝트별 키트와 Debug/Release 선택은 `project-selections/`에 보관합니다. 기본 빌드 위치는 `.pro` 폴더입니다. 프로필이나 VS Code 실행 옵션에 따라 개인 저장소 경로가 달라질 수 있습니다.
- **Qt Pro: Kit Settings (키트 설정)** 화면에서 다른 설치 경로의 키트를 추가·수정할 수 있습니다. 키트 식별자는 자동으로 관리합니다.
- 이 PC의 Qt 4.8.1 / 구형 MinGW 32비트, Qt 5.15.19 / MinGW 8.1 32·64비트, Qt 6.11.0 / MinGW 13.1 64비트를 자동 발견합니다.
- 실행 프로세스에만 선택한 Qt·컴파일러 경로를 먼저 적용합니다. 시스템 PATH는 변경하지 않습니다.
- 개인 설정은 프로젝트 경로·키트·Debug/Release별로 유지합니다. 별도 빌드 폴더는 Shadow build를 켰을 때만 사용합니다. 같은 경로에서 브랜치를 바꿔도 선택한 키트와 개인 설정은 유지합니다.
- qmake와 make는 VS Code 작업 터미널에서 실행됩니다. 중단은 터미널의 작업 종료 버튼을 사용합니다. qmake 또는 make가 실패하면 다음 단계를 실행하지 않습니다.

## 파일 목록과 실제 빌드

`.pro`, 재귀적인 `include(.pri)`, `SUBDIRS`, 변수 확장, `$$files`, `.qrc` 내부 파일을 읽습니다. Qt/OS/컴파일러 조건 안의 선언은 합쳐서 표시합니다. 파일 목록을 보는 동안 qmake나 프로젝트 스크립트를 실행하지 않습니다.

예를 들어 `HydraX.pro`에서 `HydraCommon.pri`를 include하면 `HydraX → HydraCommon → Headers → Common`으로 표시합니다. 루트에는 `.pro`가 직접 선언한 파일 분류만 표시합니다. 같은 파일을 여러 `.pri`에서 직접 선언했다면 각각의 위치에 표시할 수 있습니다. 빌드와 IntelliSense에는 전체 프로젝트 파일 목록을 계속 사용합니다.

파일 없이 하위 폴더 하나만 이어지는 경로는 `..\DBCommon`처럼 한 줄로 묶습니다. 파일이 있거나 경로가 갈라지는 폴더는 유지합니다. 정적으로 확정된 변수의 `equals`, `isEqual`, `isEmpty` 및 부정 조건이 거짓이면 해당 `.pri`의 파일을 회색으로 표시합니다. 같은 파일이 다른 `.pri`에서는 활성일 수 있으며, 회색 파일도 열 수 있습니다. 키트/플랫폼 조건, `else`, 사용자 함수 등 확실히 판정하지 못하는 조건은 임의로 비활성화하지 않습니다. 전체 qmake 조건 평가를 대체하는 기능은 아닙니다.

이 트리는 qmake의 완전한 인터프리터가 아닙니다. 사용자 함수·반복문·복잡한 치환으로 계산되는 목록은 일부 누락될 수 있습니다. **Qt Pro: Show Project Parsing Notes**에서 해석하지 못한 경로를 확인할 수 있습니다. 실제 빌드는 선택한 키트의 qmake가 원래 프로젝트를 해석합니다.

출력·중간 파일 경로는 프로젝트의 qmake 규칙을 그대로 사용하며, 지정하지 않은 경우에는 qmake 기본값을 따릅니다. `system()`, `QMAKE_POST_LINK` 같은 자체 생성·배포 명령도 그대로 실행됩니다. 개인 설정을 프로젝트 밖에 보관한다는 조건과 실제 빌드 산출물의 위치는 별개입니다.

프로젝트 출력 실행 설정에서 실행 파일을 지정하지 않았을 때 Makefile의 실제 출력 EXE를 사용합니다. 상위 SUBDIRS 프로젝트는 하위 Makefile을 따라 실행 가능한 EXE를 찾고 DLL은 제외합니다. EXE가 하나면 자동 실행하며 여러 개면 선택한 대상을 해당 프로젝트·키트·구성에 저장합니다. 실행 대상이 없으면 안내를 표시하며 파일 선택 창을 자동으로 띄우지 않습니다. 라이브러리 프로젝트나 별도 배포 위치는 **Qt Pro: Run Settings** 또는 **Qt Pro: Select Run Executable**로 지정합니다. 지정한 경로에 파일이 없으면 오류를 표시하며 다른 EXE로 바꿔 실행하지 않습니다.

하단 **프로젝트 이름 ▾** 또는 **Qt Pro: Project Settings**에서 프로젝트와 키트를 선택하고 **Build / Deploy / Run Settings** 탭을 전환합니다. 프로젝트 선택은 열어 둔 최상위 `.pro`를 대상으로 합니다. `.pro` 우클릭의 설정 명령은 해당 파일의 탭을 열며 활성 프로젝트를 바꾸지 않습니다. 탭 전환은 입력값을 유지하고, 프로젝트·키트·구성을 바꿀 때 수정 내용을 먼저 저장합니다. 잘못된 입력이 있으면 전환을 중단하고 오류를 표시합니다. 활성 프로젝트와 실행 대상을 Run과 F5가 공유하며 선택은 개인 저장소에 유지됩니다. 파일을 열거나 하위 `.pro`를 우클릭해 빌드·qmake·Clean·Rebuild해도 활성 프로젝트를 바꾸지 않습니다. 하단 빌드 버튼은 활성 프로젝트를 빌드합니다.

반복하는 같은 프로젝트 작업은 기존 작업 터미널을 재사용합니다. qmake·Build·Clean·Run은 작업별 터미널을 사용하며, 실행 중인 프로그램을 새 Run으로 덮어쓰지 않습니다. 이전 버전이 만든 터미널은 자동으로 삭제하지 않으며 휴지통 버튼으로 정리할 수 있습니다.

범위: 프로젝트 트리, 키트 선택, 빌드·실행, C/C++ GDB 디버깅 연결. UI 디자이너와 Qt Creator 수준의 코드 모델은 포함하지 않습니다. 최초 자동 발견은 Windows MinGW용이며 MSVC 환경 초기화는 제공하지 않습니다.

## 개발

`npm ci`, `npm test`. npm 런타임 패키지는 사용하지 않으며 Microsoft C/C++ (`ms-vscode.cpptools`) 확장을 필수 의존성으로 지정합니다. Qt Extension Pack은 필요하지 않습니다. 개인용 VSIX로 이 PC에 설치하며 Marketplace에 게시하지 않습니다.

`Package.ps1`은 `package.json`의 버전으로 VSIX를 생성합니다. 생성 후 Windows PowerShell에서 `test/Test-VsixPackage.ps1 -PackagePath <VSIX 경로>`를 실행해 .NET 패키지 판독기로 모든 항목의 콘텐츠 형식, 필수 파일, 설치 대상과 버전 일치를 검증합니다.

Git용 소스에는 `src/`, `media/`, 테스트 코드·입력 소스, 설정 파일과 이 안내를 포함합니다. `node_modules/`, 컴파일 결과 `out/`, VSIX, 생성된 테스트 결과·개인 VS Code 프로필은 `.gitignore`로 제외합니다. 빌드는 Node.js 22 이상과 Windows PowerShell 7 환경에서 다음과 같이 수행할 수 있습니다.

```powershell
npm ci
npm test
pwsh -NoProfile -File ./Package.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File ./test/Test-VsixPackage.ps1 -PackagePath ./qt-pro-workbench-0.12.4.vsix
```

`npm test`는 단위 테스트를 실행합니다. `test/*integration.cjs`는 별도 VS Code 시험 창에서 실행하는 통합 검증이며, 일부는 개발 PC의 Qt SDK나 Hydra 프로젝트 경로를 사용합니다. 해당 환경에 맞춰 경로를 지정한 뒤 필요한 검증만 실행합니다. 소스 파일에 저장한 기본 Qt 탐색 경로와 예시 경로는 사용자 설정 데이터가 아닙니다.

## CMake 프로젝트 (0.12.0)

**+ → CMakeLists.txt**로 프로젝트를 열면 기존 프로젝트 트리와 Build / Deploy / Run Settings를 사용합니다. 활성 프로젝트 버튼은 상세 설정, Debug/Release 버튼은 구성 선택을 엽니다. CMake 키트에는 `cmake.exe`, 생성기, Ninja/Make 경로, C/C++ 컴파일러, 선택 사항인 toolchain 파일과 Visual Studio 플랫폼을 지정할 수 있습니다. **키트 관리 → 설치된 Qt / CMake 자동 찾기**로 키트를 추가합니다. Qt qmake 키트도 CMake 프로젝트에서 사용할 수 있으며 해당 Qt 설치 경로를 CMake에 전달합니다. Qt를 쓰지 않는 프로젝트는 qmake 경로를 비웁니다.

Build Settings의 CMake 인수에는 `-DNAME=value` 같은 옵션을 넣습니다. 기본 빌드 인수는 `--parallel CPU수`이며 qmake의 `-j`와 구분됩니다. 빌드 대상은 `--target 대상이름`으로 지정합니다. Configure는 `cmake -S ... -B ...`, Build/Clean은 `cmake --build`를 실행합니다. 생성기·컴파일러 변경으로 기존 캐시와 충돌하면 새 빌드 폴더를 지정합니다. CMake는 기본적으로 `%LOCALAPPDATA%/QtProWorkbench/cmake-builds` 아래에 프로젝트·키트·Debug/Release별 폴더를 사용합니다. 별도 경로도 지정할 수 있으며 소스 폴더 안에 캐시를 만들지 않습니다.

Configure 전에는 소스 폴더의 파일 목록을 표시하고, Configure 후에는 CMake File API의 실제 소스·실행 대상·include·define·컴파일러 정보를 사용합니다. 실행 파일이 여러 개면 Run Settings에서 실행 대상을 선택합니다. GDB 키트는 기존 디버깅·Qt 4 변수 표시와 Codex 공식 API 제어를 사용합니다. MSVC 키트는 C/C++ 확장의 Visual Studio 디버거를 사용하며 Ninja/NMake + MSVC는 키트 환경변수에 해당 개발 환경을 지정해야 합니다. CMake File API에는 CMake 3.14 이상이 필요하며 컴파일러 자동 조회는 3.20 이상에서 제공됩니다. CMake와 컴파일러는 VSIX에 포함하지 않습니다.
