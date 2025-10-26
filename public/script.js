const socket = io();
let partnerId = null;
let localStream = null;

const pc = new RTCPeerConnection({
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    {
      urls: "turn:192.168.81.78:3478", 
      username: "testuser",
      credential: "testpass"
    }
  ]
});

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const chat = document.getElementById("chat");
const msgBox = document.getElementById("msgBox");
const toggleMicBtn = document.getElementById("toggleMic");
const toggleCamBtn = document.getElementById("toggleCam");

async function startMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert("❌ Camera/Mic not supported or blocked. Use HTTPS or allow permissions.");
    return;
  }

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    localVideo.srcObject = localStream;
    localVideo.muted = true;
    localVideo.play();
    localVideo.style.transform = "scaleX(-1)"; // mirror local feed

    pc.ontrack = (event) => {
  remoteVideo.srcObject = event.streams[0];
  remoteVideo.onloadedmetadata = () => {
    remoteVideo.play().catch((err) => console.warn("⚠️ Autoplay blocked:", err));
  };
  remoteVideo.style.transform = "scaleX(-1)"; // 👈 mirror stranger's video too
};


    pc.onicecandidate = (event) => {
      if (event.candidate && partnerId) {
        socket.emit("signal", { to: partnerId, data: { type: "ice", candidate: event.candidate } });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log("ICE State:", pc.iceConnectionState);
      if (pc.iceConnectionState === "failed") {
        console.warn("❌ ICE connection failed, retrying...");
      }
    };
  } catch (err) {
    console.error("getUserMedia failed:", err);
    alert("🎥 Failed to access camera/mic: " + err.message);
  }
}

/* ===== Socket Events ===== */
socket.on("connect", () => console.log("🟢 Connected:", socket.id));
socket.on("waiting", () => log("⌛ Waiting for a partner..."));

socket.on("paired", async ({ peerId }) => {
  partnerId = peerId;
  console.log("🎯 Matched with", partnerId);

  // only one peer should create the offer
  if (socket.id > partnerId) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit("signal", { to: partnerId, data: { type: "offer", sdp: offer } });
  }
});

document.getElementById("mirrorBtn").onclick = () => {
  const mirrored = localVideo.style.transform === "scaleX(-1)";
  localVideo.style.transform = mirrored ? "scaleX(1)" : "scaleX(-1)";
  remoteVideo.style.transform = mirrored ? "scaleX(1)" : "scaleX(-1)";
};

socket.on("signal", async ({ from, data }) => {
  partnerId = from;

  if (data.type === "offer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("signal", { to: from, data: { type: "answer", sdp: answer } });

  } else if (data.type === "answer") {
    await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));

  } else if (data.type === "ice" && data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate);
    } catch (err) {
      console.error("❌ ICE add failed:", err);
    }
  }
});


document.getElementById("startBtn").onclick = async () => {
  await startMedia();

  const country = document.getElementById("country").value;
  const interests = document.getElementById("interests").value
    .split(",")
    .map((i) => i.trim().toLowerCase())
    .filter(Boolean);

  socket.emit("join_queue", { country, interests });
};


async function detectCountry() {
  try {
    const res = await fetch("https://ipapi.co/json");
    const data = await res.json();
    document.getElementById("country").value = data.country_code;
  } catch (err) {
    console.log("🌍 Country detect failed:", err);
  }
}
detectCountry();


/* ===== Chat & Disconnect ===== */
socket.on("message", ({ from, message }) => log(`👤 ${from}: ${message}`));
socket.on("partner_left", () => {
  log("⚠️ Partner disconnected");
  remoteVideo.srcObject = null;
  partnerId = null;
});

/* ===== Button Handlers ===== */
document.getElementById("startBtn").onclick = async () => {
  await startMedia();
  socket.emit("join_queue");
};

document.getElementById("nextBtn").onclick = () => {
  socket.emit("next");
  chat.innerHTML = "";
  remoteVideo.srcObject = null;
};

document.getElementById("sendBtn").onclick = () => {
  const text = msgBox.value.trim();
  if (text && partnerId) {
    socket.emit("message", { to: partnerId, message: text });
    log(`🧍 You: ${text}`);
    msgBox.value = "";
  }
};

/* ===== Media Controls ===== */
toggleMicBtn.onclick = () => {
  if (localStream) {
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      toggleMicBtn.textContent = audioTrack.enabled ? "🎤 Mute" : "🎤 Unmute";
    }
  }
};

toggleCamBtn.onclick = () => {
  if (localStream) {
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      toggleCamBtn.textContent = videoTrack.enabled ? "🎥 Stop Camera" : "🎥 Start Camera";
    }
  }
};

/* ===== Utility ===== */
function log(msg) {
  chat.innerHTML += `<div>${msg}</div>`;
  chat.scrollTop = chat.scrollHeight;
}
