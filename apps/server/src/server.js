import 'dotenv/config';
// console.log(process.env)
import {app} from './app.js'



app.listen(3000,()=>console.log("listening on port 3000"));