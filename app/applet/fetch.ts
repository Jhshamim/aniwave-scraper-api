import https from 'https';

https.get('https://aniwaves.ru/filter?keyword=naruto', (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log(data.substring(0, 2000));
  });
}).on('error', (err) => {
  console.log('Error: ' + err.message);
});
