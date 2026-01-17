import fs from 'fs';



export function pngToBase64(filePath){
    try{
        const bits=fs.readFileSync(filePath);
        return bits.toString('base64');

    }catch(error){
        console.log("failed to convert the image");
        throw error;
    }
}