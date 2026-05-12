const url = "https://extractpurchaseagreementdata-i3ag2xha6a-uc.a.run.app";

async function test() {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data: { text: "test document" } })
        });
        const text = await response.text();
        console.log("HTTP STATUS:", response.status);
        console.log("BODY:", text);
    } catch (e) {
        console.error(e);
    }
}
test();
