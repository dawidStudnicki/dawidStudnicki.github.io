const fs = require('fs');

const config = require('./config');
const fm = require('front-matter');
const marked = require('./marked');

const posthtml = data => `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="${data.attributes.description}" />
    <link rel="stylesheet" href="../assets/styles/grotesk.light.min.css">
    <link rel="stylesheet" href="../assets/styles/main.min.css">
    <link rel="stylesheet" href="../assets/styles/highlights.css">
    <title>${data.attributes.title}</title>
  </head>
  <body>
    <header>
      <a href="/">Go back home</a>
    </header>
    <div class="content">
      <h1>${data.attributes.title}</h1>
      <p>${new Date()}</p>
      <hr />
      ${data.body}
    </div>
  </body>
</html>
`;

const createPost = postPath => {
  const data = fs.readFileSync(`${config.dev.postsdir}/${postPath}.md`, 'utf8');
  const content = fm(data);
  content.body = marked(content.body);
  content.path = postPath;
  return content;
};

const createPosts = posts => {
  posts.forEach(post => {
    if (!fs.existsSync(`${config.dev.outdir}/${post.path}`))
      fs.mkdirSync(`${config.dev.outdir}/${post.path}`);

    fs.writeFile(
      `${config.dev.outdir}/${post.path}/index.html`,
      posthtml(post),
      e => {
        if (e) throw e;
        console.log(`${post.path}/index.html was created successfully`);
      }
    );
  });
};

module.exports = {
  createPost: createPost,
  createPosts: createPosts,
};
