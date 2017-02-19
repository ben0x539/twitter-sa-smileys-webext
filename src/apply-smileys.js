const smileysListURL = "https://forums.somethingawful.com/misc.php?action=showsmilies";

function log(...args) {
  //return console.log(...args);
}

function loadSmileys() {
  const store = browser.storage.local;
  log({store});
  return store.get().then(state => {
    if (state[0]) {
      state = state[0]; // firefox <52 returns [state].
    }
    log({state});
    const smileys = state.smileys || {};
    log({smileys});
    const now = (new Date().getTime()/1000)|0;
    if (state.lastUpdated) {
      const d = now - state.lastUpdated;
      log({now, lastUpdated: state.lastUpdated, d});
      if (d < 60*60*24) {
        log("recent enough");
        return smileys;
      }
    }

    return fetch(smileysListURL).then(r => {
      log({r});
      if (!r.ok) {
        return null;
      }

      return r.text();
    }).then(t => {
      log({t});
      if (t === null) {
        return {};
      }

      const smileys = {};
      let match;
      const re = new RegExp(`<li class="smilie">\n` +
        `<div class="text">([^<]+)</div>\n` +
        `<img alt="[^"]*" src="([^"]+)" title="[^"]*">`, "g");

      let i;
      for (i = 0; match = re.exec(t); ++i) {
        let [_, smileyText, smileyURL] = match;
        smileys[smileyText] = smileyURL;
      }
      log({smileys});

      return store.set({
        smileys: smileys,
        lastUpdated: now,
      }).then(() => smileys);
    });
  });
}

const smileyData = {};

const inProgress = {};

function findSmileyEnd(str) {
  // ":", then stuff, then either ":", something followed by space, or EOF
  let text = /^:[^:\s]+(?::|.(?=\s)|$)/.exec(str);
  if (text !== null) {
    text = text[0];
  }
  return text;
}

function detectSmiley(smileys, text) {
  let smileyText, smiley;

  var c = text.charAt(0);
  if (!(c == ":" || c == ";") || // note ";)", ";-*"
      (!(smiley = smileys[smileyText = text.substr(0, 2)]) && // :)
       !(smiley = smileys[smileyText = text.substr(0, 3)]) && // ;-*
       !(smiley = smileys[smileyText = findSmileyEnd(text)]))) {
    smileyText = smiley = null;
  }

  return { smiley, smileyText };
}

function setSrc(node, img) {
  node.setAttribute("src", img.getAttribute("src"));
  const factor = node.saSmileyFontSizeScaleFactor;
  node.setAttribute("width", img.naturalWidth * factor);
  node.setAttribute("height", img.naturalHeight * factor);
}

function startFetch(smiley, url) {
  fetch(url).then((r) => {
    if (!r.ok) {
      throw new Exception("error fetching " + url + ": " + r.statusText + "\n"
        + r.responseText);
    }

    return r.blob();
  }).then((b) => {
    let objUrl = URL.createObjectURL(b);
    let image = new Image();
    image.onload = () => {
      log({when: new Date(), url: url});
      for (const node of smiley.waiting) {
        setSrc(node, image);
      }
      delete smiley.waiting;
      smiley.image = image;
    };
    image.setAttribute("src", objUrl);
  });
}

function asyncSetSrcData(node, text, url) {
  let smiley = smileyData[text];
  if (!smiley) {
    smiley = smileyData[text] = {};
  }

  if (smiley.image) {
    setSrc(node, smiley.image);
  } else if (smiley.waiting) {
    smiley.waiting.push(node);
  } else {
    smiley.waiting = [node];
    startFetch(smiley, url);
  }
}

function getScaleFactor(node) {
  const fontSizeStr = getComputedStyle(node).fontSize;
  if (fontSizeStr.length < 3 || fontSizeStr.substr(fontSizeStr.length - 2, 2) != "px") {
    return 1;
  }

  const fontSize = fontSizeStr.substr(0, fontSizeStr.length - 2)|0;

  return Math.max(1, (fontSize / 10)|0);
}

function applySmileys(smileys, post) {
  const classList = post.classList;
  if (classList.contains("has-sa-smileys")) {
    return;
  }

  classList.add("has-sa-smileys");

  const scaleFactor = getScaleFactor(post);
  for (const textNode of post.childNodes) {
    let text = textNode.nodeValue;
    if (text === null) {
      continue;
    }
    log({textNode});

    let nodes = [];
    for (let j = 0; j < text.length - 1; ++j) {
      const chunk = text.substr(j);
      const { smiley, smileyText } = detectSmiley(smileys, chunk);
      if (!smiley) {
        continue;
      }

      nodes.push(document.createTextNode(text.substr(0, j)));
      const imgNode = document.createElement("img");
      imgNode.saSmileyFontSizeScaleFactor = scaleFactor;
      asyncSetSrcData(imgNode, smileyText, smiley);
      imgNode.setAttribute("alt", smileyText);
      imgNode.setAttribute("title", smileyText);
      imgNode.setAttribute("class", "sa-smiley");
      nodes.push(imgNode);
      const oldText = text;
      text = text.substr(j + smileyText.length);

      j = 0;
    }

    if (nodes.length > 0) {
      for (let newNode of nodes) {
          post.insertBefore(newNode, textNode);
      }
      post.insertBefore(document.createTextNode(text), textNode);
      post.removeChild(textNode);
    }
  }
}

let styleInitialized = false;

function initStyle(elem) {
  if (styleInitialized) {
    return;
  }
  styleInitialized = true;

  const styleSheet = document.createElement("style");
  styleSheet.setAttribute("type", "text/css");
  styleSheet.textContent = ".sa-smiley { image-rendering: pixelated; image-rendering: crisp-edges; image-rendering: -moz-crisp-edges; /* i hate the web */ }";

  document.head.appendChild(styleSheet);
}

function run(smileys, context) {
}

const observerConfig = {childList: true, characterData: true, subtree: true};
function makeObserver(target, f) {
  function observe(mutationRecords, observer) {
    observer.disconnect();
    try {
      for (const m of mutationRecords) {
        log({m});
        f(m.target);
      }
    } finally {
      observer.observe(target, observerConfig);
    }
  }

  const observer = new MutationObserver(observe);
  observer.observe(target, observerConfig);
}

loadSmileys().then(smileys => {
  run(document.body);

  makeObserver(document.body, node => {
    let posts = node.querySelectorAll('p.tweet-text, h1[role="heading"] span span, [data-testid="messageEntry"] div div div div span span'); // mobile is wild
    log({posts});

    for (const post of posts) {
      initStyle(post);
      applySmileys(smileys, post);
    }
  });
}).then(null, e => console.log(e));
