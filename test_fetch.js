async function run() {
  const res = await fetch("http://localhost:5000/api/blogs/how-to-send-rakhi-abroad-from-india");
  const data = await res.json();
  if (data.success && data.data) {
    console.log("SUCCESS!");
    const post = data.data;
    for (const block of post.content) {
      if (block.text && block.text.includes("Get your free")) {
        console.log("API BLOCK TEXT JSON:");
        console.log(JSON.stringify(block.text));
      }
    }
  } else {
    console.log("FAILED TO FETCH:", data);
  }
}

run().catch(console.error);
