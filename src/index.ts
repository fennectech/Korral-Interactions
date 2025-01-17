import { Response } from "node-fetch"
import { readFileSync, existsSync, writeFileSync, readdirSync } from "fs"
import fetch from "node-fetch"
import { config } from "../config"
import Builder from './builder'
import {
  Interaction,
  Config,
  MessageComponent,
  InteractionResponse,
  BuilderApiJson,
  BuilderApiModule,
  SDLayoutOS,
  InteractionAckOptions,
  User,
  ThreadCreateOptions,
  Message,
} from "../typings"
import express from "express"
import {
  verifyKeyMiddleware,
  InteractionType,
  InteractionResponseType,
} from "discord-interactions"
import DeepSea from "./deepsea"
const discord_api = "https://discord.com/api/v9"
const builder_api = "https://builder.teamneptune.net/meta.json"
const app = express()
const port = process.env.PORT || config.port || 3000
const public_key = process.env.public_key || config.public_key

//Builder
let builder = new Builder()

let buildCategories = []

//Get latest builder API data
function checkForLatestBuildApi() {
  return new Promise(async (resolve) => {
    let current = existsSync("./buildermeta.json")?(JSON.parse(readFileSync("./buildermeta.json").toString()) as BuilderApiJson):undefined
    if(current  && (current.lastUpdated * 1000) > Date.now()){
      console.log(`Cached builder data new enough, valid until ${new Date(current.lastUpdated * 1000).toString()}`)
      Object.keys(current.modules)
      .map(moduleName => current.modules[moduleName].category)
      .forEach((builderCat) => {
        if(!buildCategories.includes(builderCat))
          buildCategories.push(builderCat)
      })
      return resolve(true)
    }
    console.log(`Fetching latest builder data from '${builder_api}'...`)
    try {
      const response = await fetch(builder_api, {
          "method":"GET"
      })
      let data = (await response.json() as BuilderApiJson)
      data.lastUpdated = data.lastUpdated + 3900
      writeFileSync("./buildermeta.json", JSON.stringify(data))
      console.log("Latest builder data fetched!")
      Object.keys(current.modules).map(moduleName => {
        return current.modules[moduleName].category
      }).forEach((builderCat, index, array) => {
        if(!buildCategories.includes(builderCat))
          buildCategories.push(builderCat)
      })
      return resolve(true)
    }catch(err){console.error(err)}
  })
}
checkForLatestBuildApi()

app.use("/interactions", verifyKeyMiddleware(public_key))

let hasActiveTickets = {}

//Set props/methods
app.use("/interactions", (req, res, next) => {
  const interaction: Interaction = req.body
  req.body.packageBuilder = {
    builder:builder,
    store:builder,
    checkForLatestBuildApi:checkForLatestBuildApi,
    buildCategories:buildCategories
  }
  req.body.internalBot = {
    config:config
  }
  req.body.ack = (options?:InteractionAckOptions) => {
    return new Promise((res, rej) => {
      interaction.acked = true;
      fetch(`${discord_api}/interactions/${interaction.id}/${interaction.token}/callback`, {
        "method":"POST",
        "headers":{
          "Content-Type":"application/json"
        },
        "body":JSON.stringify({
          type:5,
          data:options.ephemeral?{flags:64}:undefined
        })
      })
      .then(res)
      .catch(rej)
    })
  }
  req.body.sendMessage = (channelId:string, msg:Message) => {
    return new Promise((res, rej) => {
      fetch(`${discord_api}/channels/${channelId}/messages`, {
        "method":"POST",
        "headers":{
          "authorization":`Bot ${config.bot_token}`,
          "Content-Type":"application/json"
        },
        "body":JSON.stringify(msg)
      })
      .then(res)
      .catch(rej)
    })
  }
  req.body.reply = (options:InteractionResponse) => {
    if(options.ephemeral)
      options.flags = 64
    return new Promise((res, rej) => {
      fetch(`${discord_api}${interaction.acked?`/webhooks/${interaction.application_id}/${interaction.token}`:`/interactions/${interaction.id}/${interaction.token}/callback`}`, {
        "method":"POST",
        "headers":{
          "Content-Type":"application/json"
        },
        "body":JSON.stringify(interaction.acked?options:{
          type:4,
          data:options
        })
      })
      .then(res)
      .then(rej)
      interaction.acked = true;
    })
  }
  req.body.lockThread = (channelId:string) => {
    return new Promise((resolve, reject) => {
      fetch(`${discord_api}/channels/${channelId}`, {
        "method":"PATCH",
        headers:{
          "authorization":`Bot ${config.bot_token}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          archived:true,
          locked:true
        })
      })
      .then(resolve)
      .catch(reject)
    })
  }
  req.body.createSupportThread = (shortDesc:string, userId:string, privateTicket:boolean) => {
    let options:ThreadCreateOptions = {
      name:`${privateTicket?"🔒":"🔓"} - ${shortDesc}`,
      auto_archive_duration:1440,
      type:11
    }
    return new Promise((resolve, reject) => {
      if(hasActiveTickets[userId])
        return resolve(`You already have a ticket opened. Please close your current ticket to open a new one.`)
      hasActiveTickets[userId] = true;
      fetch(`${discord_api}/channels/${config.supportChannelId}/threads`, {
        "method":"POST",
        headers:{
          "authorization":`Bot ${config.bot_token}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify(options)
      })
      .then(r => r.json())
      .then(resolve)
      .catch(reject)
    })
  }
  req.body.closeSupportThread = (channelId:string, userId:string) => {
    hasActiveTickets[userId] = false;
    return new Promise((resolve, reject) => {
      interaction.lockThread(channelId)
      .then(resolve)
      .catch(reject)
    })
  }
  req.body.joinThread = (channelId:string) => {
    return new Promise((resolve, reject) => {
      fetch(`${discord_api}/channels/${channelId}/thread-members/@me`, {
        "method":"PUT",
        headers:{
          "authorization":`Bot ${config.bot_token}`
        }
      })
      .then(resolve)
      .catch(reject)
    })
  }
  req.body.fetchActiveThreads = (guildId:string) => {
    return new Promise((resolve, reject) => {
      fetch(`${discord_api}/guilds/${guildId}/threads/active`, {
        "method":"GET",
        headers:{
          "authorization":`Bot ${config.bot_token}`
        }
      })
      .then(resolve)
      .catch(reject)
    })
  }
  if(interaction.type == InteractionType.MESSAGE_COMPONENT){
    req.body.update = (msg:InteractionResponse) => {
      if(msg.ephemeral)
        msg.flags = 64
      return new Promise((res, rej) => {
        fetch(`${discord_api}/interactions/${interaction.id}/${interaction.token}/callback`, {
          "method":"POST",
          "headers":{
            "Content-Type":"application/json"
          },
          "body":JSON.stringify({
            type:7,
            data:msg
          })
        })
        .then(res)
        .catch(rej)
      })
    }
  }
  next()
})

app.post("/interactions", (req, res) => {
  const interaction: Interaction = req.body

  // Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    try {
      return import(`./commands/${interaction.data.name}`)
      .then(command => {
        command.default.execute(interaction)
      })
      .catch(err => {
        console.error(err)
        return interaction.reply({
          content:`Uh oh, that interaction wasn't found! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
        })
      })
    } catch {
      return interaction.reply({
        content:`Uh oh, something went wrong while trying to run that! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
      })
    }
  }

  // Buttons
  if(interaction.type == InteractionType.MESSAGE_COMPONENT && interaction.data && interaction.data.component_type == 2){
    try {
      // Check for matching custom_id in src/buttons/
      let buttonCommands = readdirSync("./src/buttons").filter(file => file.endsWith(".ts"))
      return import(`./buttons/${interaction.data.custom_id}`)
      .then(command => {
        command.default.execute(interaction)
      })
      .catch(() => {
        // If the above fails, check if any file starts with custom_id
        let buttonCommand = buttonCommands.find(f => interaction.data.custom_id.startsWith(f.split(".")[0]))
        return import(`./buttons/${buttonCommand.split(".")[0]}`)
        .then(command => {
          command.default.execute(interaction)
        })
        .catch(err => {
          console.error(err)
          return interaction.reply({
            content:`Uh oh, that interaction wasn't found! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
          })
        })
      })
    } catch(err) {
      console.log(err)
      return interaction.reply({
        content:`Uh oh, something went wrong while trying to run that! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
      })
    }
  }

  // Selects
  if(interaction.type == InteractionType.MESSAGE_COMPONENT && interaction.data && interaction.data.component_type == 3){
    let builderData:BuilderApiJson = JSON.parse(readFileSync("./buildermeta.json").toString())
    try {
      interaction.packageBuilder.builderData = builderData
      // Check for matching value in src/selects/
      let selectCommands = readdirSync("./src/selects").filter(file => file.endsWith(".ts"))
      return import(`./selects/${interaction.data.values[0]}`)
      .then(command => {
        command.default.execute(interaction)
      })
      .catch(() => {
        // If the above fails, check if any file starts with custom_id
        let selectCommand = selectCommands.find(f => interaction.data.values[0].startsWith(f.split(".")[0]))
        return import(`./selects/${selectCommand.split(".")[0]}`)
        .then(command => {
          command.default.execute(interaction)
        })
        .catch(err => {
          console.error(err)
          return interaction.reply({
            content:`Uh oh, that interaction wasn't found! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
          })
        })
      })
    } catch(err) {
      console.log(err)
      return interaction.reply({
        content:`Uh oh, something went wrong while trying to run that! 😬\nOpen an issue on [GitHub](https://github.com/Team-Neptune/Korral-Interactions) if the issue persists.`
      })
    }
  }

  //Selects
  if(interaction.type == InteractionType.MESSAGE_COMPONENT && interaction.data && interaction.data.component_type == 3){
    if(!builder.sessionExists(interaction.member?interaction.member.user.id:interaction.user.id))
      return interaction.update({
        "content":`Your session wasn't found. It may have timed out due to no interaction after 15 minutes. Please run the /builder command to start a new session. If this is occurring multiple times, and it hasn't been 15 minutes, open an issue on the [GitHub Repo](<https://github.com/Team-Neptune/Korral-Interactions>).`,
        "components":[]
      })
  }
})

function setupDeepsea() {
  let deepsea = new DeepSea()
  deepsea.update().then(() => console.log(`Deepsea data setup!`))
}
setInterval(() => {
  let deepsea = new DeepSea()
  deepsea.update()
}, 60 * 60 * 1000)

app.listen(port, () => {
  setupDeepsea()
  console.log(`Ready to listen for interactions on port: ${port}`)
})

