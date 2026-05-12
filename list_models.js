const apiKey = "AIzaSyDpRq07H4LY34m4wdwq1Br15KOR7g6MewY";
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function test() {
    try {
        const response = await fetch(url);
        const data = await response.json();
        const models = data.models.map(m => m.name);
        console.log("AVAILABLE MODELS:", models);
    } catch (e) {
        console.error(e);
    }
}
test();
