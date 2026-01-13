import { Groq } from 'groq-sdk';
import 'dotenv/config';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
export async function processScreenshot(ariaSnapshot) {
  const chatCompletion = await groq.chat.completions.create({
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "text",
            "text": `I am providing you with the screenshot and aria snapshot of the website , figure out if it has any cookies or banners and return the selector for them so we can interact with the close or accept button and get the website without any of the cookies section , banners or popups . our final goal is to take the clean screenshot of the website .Return the json object  carefully .snapshot-${ariaSnapshot}`
          },
          {
            "type": "image_url",
            "image_url": {
              "url": "https://fastly.picsum.photos/id/237/200/300.jpg?hmac=TmmQSbShHz9CdQm0NkEjx1Dyh_Y984R9LpNrpvH2D_U"
            }
          }
        ]
      }
    ],
    "response_format": {
    "type": "json_schema",
    "json_schema": {
      "name": "hasPopups",
      "strict": false,  // or omit this field (defaults to false)
      "schema": { 
        
        type:"object",
        properties:{
          hasPopups:{
            type:"boolean"
          },
          selectors:{
            type:"array",
            items:{
              type:"string"
            }
          },
        }

       }
    }
  },

    "model": "meta-llama/llama-4-scout-17b-16e-instruct",
    "temperature": 1,
    "max_completion_tokens": 1024,
    "top_p": 1,
    "stream": false,
    "stop": null
  });

   console.log(chatCompletion.choices[0].message.content);
}

processScreenshot();