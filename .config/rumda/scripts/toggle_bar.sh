#!/bin/bash
hasone=$(quickshell list -p ~/.config/rumda/common/quickshell/shell.qml)
echo $hasone
if [[ "$hasone" == *Instance* ]]; then
  quickshell kill -p ~/.config/rumda/common/quickshell/shell.qml
else
  quickshell -p ~/.config/rumda/common/quickshell/shell.qml &
  disown
fi
