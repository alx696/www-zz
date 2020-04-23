/**
 * 创建元素
 * @param html
 * @return {ChildNode}
 */
const $e = (html) => {
  let template = document.createElement('template');
  html = html.trim(); // Never return a text node of whitespace as the result
  template.innerHTML = html;
  return template.content.firstChild;
};

/**
 * 选择并复制元素内容
 */
const $sc = (e) => {
  let range = document.createRange();
  range.selectNodeContents(e);
  let selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.execCommand('copy');
};

const $vtt = {
  string2Seconds(timeString) {
    let ts = parseInt(timeString.substr(-3));
    let secs = parseInt(timeString.substr(-6, 2));
    let mins = parseInt(timeString.substr(-9, 2));
    let hours = timeString.length > 9 ? parseInt(timeString.substr(0, timeString.indexOf(':'))) : 0;

    if (!Number.isFinite(ts) || !Number.isFinite(secs) || !Number.isFinite(mins) || !Number.isFinite(hours)) {
      return -1;
    }

    ts += 1000 * secs;
    ts += 60 * 1000 * mins;
    ts += 60 * 60 * 1000 * hours;

    return parseFloat((ts / 1000).toFixed(3));
  },

  secondsToString(seconds) {
    const fillZeroToPrefix = (num, length) => {
      for (let len = (num + "").length; len < length; len = num.length) {
        num = "0" + num;
      }
      return num;
    };
    const m = 60;
    const h = 3600;
    let hsText = '00';
    let msText = '00';
    let ssText = '00.000';

    if (seconds >= h) {
      let hs = parseInt(seconds / h);
      hsText = fillZeroToPrefix(hs, 2);
      seconds -= hs * h;
    }

    if (seconds >= m) {
      let ms = parseInt(seconds / m);
      msText = fillZeroToPrefix(ms, 2);
      seconds -= ms * m;
    }

    if (seconds > 0) {
      seconds = parseFloat(seconds).toFixed(3);
      ssText = fillZeroToPrefix(seconds, 6);
    }

    return `${hsText}:${msText}:${ssText}`;
  },

  textToVttCueArray(text) {
    const S = this;
    return new Promise((resolve, reject) => {
      try {
        const cueArray = [];
        const onSection = (data) => {
          const cue = new VTTCue(data.startTime, data.endTime, data.text);
          //TODO 字幕位置属性 _position 暂不支持, 需要实现
          cueArray.push(cue);
        };
        const onCompleted = () => {
          resolve(cueArray);
        };
        const array = text.split('\n');
        const cache = {
          skip: false,
          read: false
        };
        array.forEach((line, lineIndex) => {
          //有读取标记时读取内容
          if (cache.read && line !== '') {
            if (cache.section.text !== '') {
              cache.section.text += '\n';
            }
            cache.section.text += line;
          }

          if (lineIndex + 1 === array.length || line === '') {
            if (cache.read) {
              cache.read = false;

              onSection({
                startTime: cache.section.startTime,
                endTime: cache.section.endTime,
                text: cache.section.text,
                _position: cache.section.position
              });
            }
            cache.skip = false;

            //最后一行
            if (lineIndex + 1 === array.length) {
              onCompleted();
            }
          } else if (line === 'WEBVTT' || line === 'STYLE' || line === 'NOTE') {
            //跳过到下个空行之间的内容
            cache.skip = true;
          } else if (line.includes(':') && line.includes('.') && line.includes(' --> ')) {
            //有时间轴的读取字幕段落

            //分解时间轴部分
            const timeStringArray = line.split(' ');

            //读取到下个空行(最后一行)之间的内容
            cache.section = {
              startTime: S.string2Seconds(timeStringArray[0]),
              endTime: S.string2Seconds(timeStringArray[2]),
              position: timeStringArray[3],
              text: ''
            };
            cache.read = true;
          }
        });
      } catch (e) {
        reject(e);
      }
    });
  },

  vttCueArrayToText(vttCueArray) {
    const S = this;
    return new Promise((resolve, reject) => {
      try {
        //按出现时间排序数组
        vttCueArray.sort((a, b) => {
          if (a.startTime < b.startTime) {
            return -1; //a比b小
          } else if (a.startTime > b.startTime) {
            return 1; //a比b大
          }

          return 0; //想等
        });

        let text = 'WEBVTT';
        for (const cue of vttCueArray) {
          if (cue.startTime >= cue.endTime) {
            //跳过问题字段
            console.warn('问题字段:', cue);
            continue;
          }

          text += `\n\n${S.secondsToString(cue.startTime)} --> ${S.secondsToString(cue.endTime)}\n${cue.text}`;
        }
        resolve(text);
      } catch (e) {
        reject(e);
      }
    });
  }
};

const app = {
  transactionApi: 'https://translation.googleapis.com/language/translate/v2?key=AIzaSyCovLq_cQBVb3kiBr4fMI9heA4vjtwaJAw&source=en&target=zh&q=',
  video: null,
  track: null,
  cueMap: new Map(),
  activeId: '',
  list: null,
  stopTime: -1,
  windowHeight: 0,

  isMobile() {
    let is = false;
    const keywordArray = [
      'Mobile', 'Android', 'iPhone'
    ];
    for (const k of keywordArray) {
      if (navigator.userAgent.includes(k)) {
        is = true;
        break;
      }
    }
    return is;
  },

  chooseFile(accept, callback) {
    const fileInput = document.createElement('input');
    fileInput.setAttribute('type', 'file');
    if (accept) {
      fileInput.setAttribute('accept', accept);
    }
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      console.debug('选择文件:', file);

      callback(file);
    });
    fileInput.click();
  },

  chooseVttFile(callback) {
    app.chooseFile('.vtt', file => {
      let fileReader = new FileReader();
      fileReader.addEventListener('load', async evt => {
        const cueArray = await $vtt.textToVttCueArray(
            evt.target.result
        );
        console.debug('字幕cue数组:', cueArray);

        callback(cueArray);
      });
      fileReader.readAsText(file, 'UTF-8');
    });
  },

  addViewToList(cue, beforeNode) {
    //生成条目
    const ui = $e(`<section data-id="${cue.id}">
      <aside>
        <header data-ui="start">${$vtt.secondsToString(cue.startTime)}</header>
        <footer data-ui="end">${$vtt.secondsToString(cue.endTime)}</footer>
      </aside>
      <article>
        <div data-ui="refer"></div>
        <div data-ui="translate"></div>
        <div data-ui="content" contenteditable="true">${cue.text}</div>
      </article>
    </section>`);
    app.list.insertBefore(ui, beforeNode);

    //点击激活
    ui.addEventListener('click', () => {
      //缓存id
      app.activeId = cue.id;

      //视频定位到段落出现时间
      app.video.pause();
      app.video.currentTime = cue.startTime;

      //更新段落出现和消失时间
      const vttTimeStart = document.querySelector('#vttTimeStart');
      const vttTimeEnd = document.querySelector('#vttTimeEnd');
      vttTimeStart.textContent = $vtt.secondsToString(cue.startTime);
      vttTimeEnd.textContent = $vtt.secondsToString(cue.endTime);

      //激活样式
      const active = app.list.querySelector('.active');
      if (active) {
        active.classList.remove('active');
      }
      ui.classList.add('active');

      //启用字幕编辑按钮
      const control = document.querySelector('#control');
      for (const button of control.querySelectorAll('[data-ui="vttEditButton"]')) {
        button.removeAttribute('disabled');
      }
    });

    const content = ui.querySelector('[data-ui="content"]');
    const refer = ui.querySelector('[data-ui="refer"]');

    //点击选中并复制参考
    refer.addEventListener('click', () => {
      $sc(refer);
    });

    //编辑
    content.addEventListener('input', () => {
      cue.text = content.textContent;
    });

    return ui;
  },

  insertCueToList(cue, canMerge) {
    const S = this;

    //判断合并或插入位置
    let mergeId = '', beforeId = '';
    Array.from(app.cueMap.values()).forEach((existsCue, i, al) => {
      if (cue.text !== '' && cue.startTime >= existsCue.startTime && cue.endTime <= existsCue.endTime) {
        mergeId = existsCue.id;
      }

      if ((i === 0 && cue.startTime <= existsCue.startTime && cue.endTime < existsCue.endTime)
          || (i > 0 && cue.startTime <= existsCue.startTime && cue.startTime > al[i - 1].startTime)) {
        beforeId = existsCue.id;
      }
    });

    //生成段落
    let section;
    if (canMerge && mergeId !== '') {
      //合并
      section = app.list.querySelector(`[data-id="${mergeId}"]`);
    } else {
      cue.id = uuidv4();
      app.track.addCue(cue);
      app.cueMap.set(cue.id, cue);

      if (beforeId !== '') {
        //插入到列表指定id前面
        section = S.addViewToList(
            cue,
            app.list.querySelector(`[data-id="${beforeId}"]`)
        );
      } else {
        //插入到列表最后
        section = S.addViewToList(cue);
      }
    }

    //自动翻译
    if (cue.text !== '[]') {
      const content = section.querySelector('[data-ui="content"]');
      const refer = section.querySelector('[data-ui="refer"]');
      const translate = section.querySelector('[data-ui="translate"]');
      const translatedTextKey = cue.text;

      refer.textContent = translatedTextKey;
      let translatedText = localStorage.getItem(translatedTextKey);

      if (!translatedText) {
        fetch(app.transactionApi + cue.text)
            .then(response => {
              if (response.status !== 200) {
                console.warn('无法翻译');
                return;
              }

              response.json()
                  .then(json => {
                    translatedText = json.data.translations[0].translatedText;

                    localStorage.setItem(translatedTextKey, translatedText);

                    translate.textContent = translatedText;
                    if (mergeId === '') {
                      content.textContent = translatedText;
                      cue.text = translatedText;
                    }
                  });
            })
      } else {
        translate.textContent = translatedText;
        if (mergeId === '') {
          content.textContent = translatedText;
          cue.text = translatedText;
        }
      }
    }

    return section;
  },

  initVttUi() {
    app.list = document.querySelector('#list');
    const vttTimeStart = document.querySelector('#vttTimeStart');
    const vttTimeEnd = document.querySelector('#vttTimeEnd');
    const vttTimeStartTo = document.querySelector('#vttTimeStartTo');
    const vttTimeEndTo = document.querySelector('#vttTimeEndTo');
    const vttTimeStartReset = document.querySelector('#vttTimeStartReset');
    const vttTimeEndReset = document.querySelector('#vttTimeEndReset');
    const vttPlay = document.querySelector('#vttPlay');
    const vttDelete = document.querySelector('#vttDelete');
    const vttAdd = document.querySelector('#vttAdd');

    vttTimeStartTo.addEventListener('click', () => {
      const cue = app.cueMap.get(
          app.activeId
      );
      app.video.currentTime = cue.startTime;
    });
    vttTimeEndTo.addEventListener('click', () => {
      const cue = app.cueMap.get(
          app.activeId
      );
      app.video.currentTime = cue.endTime;
    });
    vttTimeStartReset.addEventListener('click', () => {
      const cue = app.cueMap.get(
          app.activeId
      );
      cue.startTime = app.video.currentTime;
      vttTimeStart.textContent = $vtt.secondsToString(cue.startTime);
      app.list.querySelector(`[data-id="${cue.id}"] [data-ui="start"]`)
          .textContent = vttTimeStart.textContent;
    });
    vttTimeEndReset.addEventListener('click', () => {
      const cue = app.cueMap.get(
          app.activeId
      );
      cue.endTime = app.video.currentTime;
      vttTimeEnd.textContent = $vtt.secondsToString(cue.endTime);
      app.list.querySelector(`[data-id="${cue.id}"] [data-ui="end"]`)
          .textContent = vttTimeEnd.textContent;
    });

    vttPlay.addEventListener('click', () => {
      const cue = app.cueMap.get(
          app.activeId
      );
      app.video.pause();
      app.video.currentTime = cue.startTime;
      app.stopTime = cue.endTime;
      app.video.play();
    });

    vttDelete.addEventListener('click', () => {
      app.video.pause();

      const result = window.prompt('确定删除?', '确定');
      if (!result || result !== '确定') {
        return;
      }

      app.track.removeCue(
          app.cueMap.get(
              app.activeId
          )
      );
      app.cueMap.delete(app.activeId);
      app.list.querySelector(`[data-id="${app.activeId}"]`)
          .remove();
      app.activeId = '';
    });

    //添加段落
    vttAdd.addEventListener('click', () => {
      app.video.pause();
      const section = app.insertCueToList(
          new VTTCue(app.video.currentTime, app.video.currentTime + 1.5, '[]')
      );
      const content = section.querySelector('[data-ui="content"]');
      content.focus();
      content.click();
    });

    //打开字幕
    document.querySelector('#openVtt')
        .addEventListener('click', () => {
          //TODO 如有字幕, 应先提醒保存.

          app.chooseVttFile(cueArray => {
            //清除已有段落
            app.cueMap.clear();
            app.list.innerHTML = '';
            for (const cue of app.track.cues) {
              app.track.removeCue(cue);
            }

            //添加新的
            for (const cue of cueArray) {
              //缓存
              cue.id = uuidv4();
              app.track.addCue(cue);
              app.cueMap.set(cue.id, cue);

              //生成视图
              app.addViewToList(cue);
            }
          });
        });

    //打开参考
    document.querySelector('#openRefer')
        .addEventListener('click', () => {
          app.chooseVttFile(cueArray => {
            for (const cue of cueArray) {
              app.insertCueToList(cue, true);
            }
          });
        });

    //保存字幕
    document.querySelector('#saveVtt')
        .addEventListener('click', async () => {
          let text = await $vtt.vttCueArrayToText(
              Array.from(app.cueMap.values())
          );
          text += `\n\nNOTE\n访问 https://zz.lilu.red 了解加入《字幕自由共享计划》！`;
          let blob = new Blob([text], {
            type: 'text/vtt'
          });
          let objectURL = URL.createObjectURL(blob);
          let a = document.createElement('a');
          a.setAttribute('href', objectURL);
          a.setAttribute('download', '简体中文字幕.vtt');
          a.click();
          //清理资源
          window.setTimeout(() => {
            window.URL.revokeObjectURL(objectURL);
          }, 100);
        });
  },

  enableVttUi() {
    document.querySelector('#openVtt')
        .removeAttribute('disabled');
    document.querySelector('#openRefer')
        .removeAttribute('disabled');
    document.querySelector('#saveVtt')
        .removeAttribute('disabled');
    document.querySelector('#vttAdd')
        .removeAttribute('disabled');
  },

  initVideoUi() {
    const video = document.querySelector('#video');
    const videoCurrentTime = document.querySelector('#videoCurrentTime');
    const videoTimeLeft = document.querySelector('#videoTimeLeft');
    const videoTimeRange = document.querySelector('#videoTimeRange');
    const videoTimeRight = document.querySelector('#videoTimeRight');
    const openVideo = document.querySelector('#openVideo');
    const videoPlay = document.querySelector('#videoPlay');
    let videoIsPlay = false;
    let videoSeekIntervalId = '';
    const playOrPause = () => {
      if (!video.src) {
        openVideo.click();

        return;
      }

      if (!videoIsPlay) {
        video.play();
      } else {
        video.pause();
      }
    };
    const stopVideoSeek = () => {
      if (videoSeekIntervalId !== '') {
        window.clearInterval(videoSeekIntervalId);
      }
    };
    const videoToLeft = () => {
      video.pause();
      const v = video.currentTime - 0.1;
      if (v > 0) {
        video.currentTime = v;
      } else {
        video.currentTime = 0;
      }
    };
    const startVideoLongLeft = () => {
      stopVideoSeek();
      videoSeekIntervalId = window.setInterval(videoToLeft, 200);
    };
    const videoToRight = () => {
      video.pause();
      const v = video.currentTime + 0.1;
      if (v < video.duration) {
        video.currentTime = v;
      } else {
        video.currentTime = video.duration;
      }
    };
    const startVideoLongRight = () => {
      stopVideoSeek();
      videoSeekIntervalId = window.setInterval(videoToRight, 200);
    };

    video.addEventListener('play', () => {
      videoIsPlay = true;
      videoPlay.textContent = '暂停';
    });
    video.addEventListener('pause', () => {
      videoIsPlay = false;
      videoPlay.textContent = '播放';
    });
    video.addEventListener('loadedmetadata', () => {
      //增加字幕轨道
      if (video.textTracks.length === 0) {
        app.track = video.addTextTrack("captions", "简体中文", "zh_CN");
        app.track.mode = "showing";
      }

      videoTimeRange.setAttribute('max', video.duration);

      videoTimeLeft.removeAttribute('disabled');
      videoTimeRange.removeAttribute('disabled');
      videoTimeRight.removeAttribute('disabled');
      videoPlay.removeAttribute('disabled');

      video.play();

      app.enableVttUi();
    });
    video.addEventListener('timeupdate', () => {
      //更新当前时间和进度
      videoCurrentTime.textContent = $vtt.secondsToString(video.currentTime);
      videoTimeRange.value = video.currentTime;

      //播放时
      if (videoIsPlay) {
        //设了停止时间的, 播放到停止时间为止
        if (app.stopTime > -1 && video.currentTime >= app.stopTime) {
          video.pause();
          video.currentTime = app.stopTime;
          app.stopTime = -1;
        }

        //列表自动滚动到当前字幕并高亮
        let highlight = app.list.querySelector('.highlight');
        for (const existsCue of app.cueMap.values()) {
          if ((!highlight || highlight.getAttribute('data-id') !== existsCue.id)
              && video.currentTime >= existsCue.startTime
              && video.currentTime <= existsCue.endTime) {
            if (highlight) {
              highlight.classList.remove('highlight');
            }

            const item = app.list.querySelector(`[data-id="${existsCue.id}"]`);
            item.classList.add('highlight');
            app.list.scrollTo(
                0,
                item.offsetTop - app.list.offsetTop
            );
          }
        }
      }
    });

    videoTimeRange.addEventListener('input', () => {
      video.pause();
      videoCurrentTime.textContent = $vtt.secondsToString(
          videoTimeRange.value
      );
    });
    videoTimeRange.addEventListener('change', () => {
      video.pause();
      video.currentTime = videoTimeRange.value;
    });
    videoTimeLeft.addEventListener('click', () => {
      stopVideoSeek();
      videoToLeft();
    });
    videoTimeLeft.addEventListener('mousedown', startVideoLongLeft);
    videoTimeLeft.addEventListener('touchstart', startVideoLongLeft, {passive: true});
    videoTimeLeft.addEventListener('mouseup', stopVideoSeek);
    videoTimeLeft.addEventListener('touchend', stopVideoSeek);
    videoTimeRight.addEventListener('click', () => {
      stopVideoSeek();
      videoToRight();
    });
    videoTimeRight.addEventListener('mousedown', startVideoLongRight);
    videoTimeRight.addEventListener('touchstart', startVideoLongRight, {passive: true});
    videoTimeRight.addEventListener('mouseup', stopVideoSeek);
    videoTimeRight.addEventListener('touchend', stopVideoSeek);

    openVideo.addEventListener('click', () => {
      app.chooseFile('.webm,.mkv,.mp4', file => {
        video.src = URL.createObjectURL(file);
      });
    });

    video.addEventListener('click', playOrPause);
    videoPlay.addEventListener('click', playOrPause);

    app.video = video;
  },

  initHotKey() {
    const video = app.video;
    window.addEventListener('keydown', evt => {
      if (video.src === '') {
        return;
      }

      switch (evt.code) {
        case 'Numpad5':
          //视频:播放或暂停
          evt.preventDefault();
          document.querySelector('#videoPlay').click();

          break;
        case 'Numpad4':
          //视频:退
          evt.preventDefault();
          document.querySelector('#videoTimeLeft').click();

          break;
        case 'Numpad6':
          //视频:进
          evt.preventDefault();
          document.querySelector('#videoTimeRight').click();

          break;
        case 'Numpad0':
          //添加字幕
          evt.preventDefault();
          document.querySelector('#vttAdd').click();

          break;
        case 'NumpadDecimal':
          //删除字幕
          evt.preventDefault();
          document.querySelector('#vttDelete').click();

          break;
        case 'Numpad1':
          //设置段落的出现时间为视频当前时间
          evt.preventDefault();
          document.querySelector('#vttTimeStartReset').click();

          break;
        case 'Numpad2':
          //视频:播放段落
          evt.preventDefault();
          document.querySelector('#vttPlay').click();

          break;
        case 'Numpad3':
          //设置段落的消失时间为视频当前时间
          evt.preventDefault();
          document.querySelector('#vttTimeEndReset').click();

          break;
        case 'NumpadAdd':
          //切换到上一条
          evt.preventDefault();
          if (app.activeId === '') {
            break;
          }
          const previousElement = app.list.querySelector(`[data-id="${app.activeId}"]`).previousElementSibling;
          if (previousElement) {
            const content = previousElement.querySelector('[data-ui="content"]');
            content.focus();
            content.click();
          }

          break;
        case 'NumpadEnter':
          //切换到下一条
          evt.preventDefault();
          if (app.activeId === '') {
            break;
          }
          const nextElement = app.list.querySelector(`[data-id="${app.activeId}"]`).nextElementSibling;
          if (nextElement) {
            const content = nextElement.querySelector('[data-ui="content"]');
            content.focus();
            content.click();
          }

          break;
      }
    });
  },

  init() {
    app.initVttUi();
    app.initVideoUi();

    app.windowHeight = window.outerHeight;
    if (app.isMobile()) {
      //手机中软键盘显示或隐藏时, 隐藏非列表视图
      window.addEventListener('resize', () => {
        if (app.activeId !== '') {
          if (window.outerHeight > app.windowHeight) {
            document.body.classList.remove('mobile-only_list');
          } else {
            document.body.classList.add('mobile-only_list');
          }
        }

        app.windowHeight = window.outerHeight;
      });
    } else {
      //电脑中快捷键
      app.initHotKey();
    }
  }
};

//禁用上下文菜单
window.addEventListener('contextmenu', evt => {
  evt.preventDefault();
});

window.addEventListener('DOMContentLoaded', () => {
  app.init();
});