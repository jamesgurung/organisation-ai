# Organisation AI

Organisation AI is a free, open-source web application that empowers your entire organisation with access to advanced AI chat capabilities&mdash;without the burden of costly per-user licenses.

Bring your own OpenAI key and deploy effortlessly to Microsoft Azure.

![Screenshot of Organisation AI](examples/screenshot.png)

Originally known as *Teacher AI* for its focus on supporting staff in schools, this app has been upgraded to meet the needs of any organisation, from businesses to nonprofits.

### Features

* A clean, professional chat interface
* Access to the latest OpenAI language models
* Customisable prompt presets for different teams
* Web search capabilities
* Understanding of uploaded images
* Document search using vector stores
* Voice-to-voice conversations
* Chat history
* Automated content moderation and manual review
* Configurable weekly spend limits
* Usage and cost dashboard
* Support for all screen sizes including mobile
* Single sign-on (SSO) using Microsoft 365

### Setup

1. Create an OpenAI account and generate an API key.

2. Create a general purpose v2 storage account in Microsoft Azure, and within it create:
    * Tables: `conversations`, `spend`, and `review`
    * Blob containers: `conversations` and `config`

3. Within the `config` blob container, upload a blank file `keys.xml`. Generate a SAS URL for this file with read/write permissions and a distant expiry. This will be used to store the application's data protection keys so that auth cookies persist across app restarts.


4. Within the `config` blob container, create a file `users.csv` with the following format:

    ```csv
    Email,UserGroup
    test@example.com,staff
    ```

5. For each user group configured in `users.csv`, create a file `<usergroup>.json` with the following format:

    ```json
    {
      "allowUploads": true,
      "introMessage": "This service is for work-related queries only.",
      "moderationThreshold": 0.7,
      "presets": [
        {
          "id": "default",
          "title": null,
          "category": null,
          "introduction": null,
          "instructions": "You are a helpful AI assistant.",
          "model": "gpt-4.1",
          "temperature": 0.2,
          "reasoningEffort": null,
          "webSearchEnabled": false,
          "vectorStoreId": null,
          "voice": null
        }
      ],
      "reviewers": [ "reviewer@example.com" ],
      "reviewThreshold": 0,
      "showPresetDetails": true,
      "stopCommands": [
        "token": "[offtopic]",
        "message": "This is off-topic."
      ],
      "userMaxWeeklySpend": 2.00
    }
    ```

    Our [examples](examples) folder contains sample configuration files for a secondary school.

    The settings are:

    * `allowUploads` - whether users in this group can upload files
    * `introMessage` - a message to display to users on the homepage in Markdown format, e.g. you may include a link to your organisation's AI policy
    * `moderationThreshold` - how certain the moderation model must be that a message is inappropriate before rejecting it and stopping the conversation (low values like 0.4 provide the most protection, whereas high values like 0.8 minimise false positives)
    * `presets` - an array of preset prompt templates that will be available to users from the sidebar
        * `id` - the ID of the preset, which is a unique string without spaces; use the ID `default` to specify the default preset which loads at the start
        * `title` - the title of the preset, displayed in the sidebar
        * `category` - the category of the preset, displayed as a heading in the sidebar
        * `introduction` - the message to display when this preset is selected, in Markdown format (note that this is not sent to the language model)
        * `instructions` - the system instructions to send to the language model along with the user's message
        * `model` - the OpenAI model to use for this preset, as configured below
        * `temperature` (optional) - the temperature to use, where supported by the model
        * `reasoningEffort` (optional) - the reasoning effort to use, where supported by the model
        * `webSearchEnabled` (optional) - whether web searches are enabled
        * `vectorStoreId` (optional) - the ID of the OpenAI vector store to use for this preset
        * `voice` (optional) - when set, this enables speech-to-speech mode using the specified voice
    * `reviewers` - an array of users to give reviewer access, which allows them to retrospectively review all AI conversations in this group
    * `reviewThreshold` - how certain the moderation model must be that a message is inappropriate before adding it to the queue for manual review (set this to 0 if you wish to review all messages)
    * `showPresetDetails` - whether to show the preset details, such as the system instructions and model name, to the user
    * `stopCommands` - specific strings that, if received from the language model, will stop the conversation and display a customised message; this needs to be used in conjunction with the model `instructions` above, and can be useful for safety purposes
        * `token` - the exact text to match in the language model's output (e.g. `[OFF TOPIC]`)
        * `message` - the warning to display to the user, in Markdown format
    * `userMaxWeeklySpend` - the amount each user is allowed to spend per week; resets Sundays (OpenAI token usage is retrospective, so users might slightly exceed the limit before restrictions apply)
 
6. Create an Azure app registration.
    * Name - `Organisation AI`
    * Redirect URI - `https://<app-website-domain>/signin-oidc`
    * Implicit grant - ID tokens
    * Supported account types - Accounts in this organizational directory only
    * API permissions - `Microsoft Graph - User.Read`
    * Token configuration - add an optional claim of type ID: `upn`

7. Create an Azure App Service web app.
    * Publish mode - Container
    * Operating system - Linux
    * Image source - Other container registries
    * Docker Hub access type - Public
    * Image and tag - `jamesgurung/organisation-ai:latest`
    * Startup command: (blank)

8. Configure the following environment variables for the web app:

    * `Organisation__Name` - the name of your organisation
    * `Organisation__AppWebsite` - the host name where this app will be hosted, e.g. `example.com`
    * `Organisation__CountryCode` - your country code, e.g. `GB` for Great Britain (used for localised web search)
    * `Organisation__City` - your city name (used for localised web search)
    * `Organisation__Timezone` - your timezone, e.g. `Europe/London` (used for localised web search)
    * `Organisation__SyncApiKey` - a secret key to be used when updating the `users.csv` file with an automated script (optional)
    * `Azure__ClientId` - the client ID of your Azure app registration
    * `Azure__TenantId` - your Azure tenant ID
    * `Azure__StorageAccountName` - the name of your Azure Storage account
    * `Azure__StorageAccountKey` - the key for your Azure Storage account
    * `Azure__DataProtectionBlobUri` - the SAS URL for the keys file you created earlier
    * `OpenAI__DefaultApiKey` - the default OpenAI API key to use for all user groups where you have not configured a specific key
    * `OpenAI__ApiKeys__0__UserGroup` - the name of the user group for which you are configuring a specific key (subsequent user groups can be configured by adding additional items with incrementing indices)
    * `OpenAI__ApiKeys__0__Key` - the OpenAI API key for this user group
    * `OpenAI__CostPer1KFileSearches` - the OpenAI credit cost per 1K file searches
    * `OpenAI__TitleSummarisationModel` - the model which will be used to summarise titles, e.g. `gpt-4.1-nano`
    * `OpenAI__Models__0__Name` - the name of an OpenAI model you would like to make available, e.g. `gpt-4.1` (subsequent models can be configured by adding additional items with incrementing indices)
    * `OpenAI__Models__0__CostPer1MInputTokens` - the model cost per 1M input tokens
    * `OpenAI__Models__0__CostPer1MCachedInputTokens` - the model cost per 1M cached input tokens
    * `OpenAI__Models__0__CostPer1MOutputTokens` - the model cost per 1M output tokens
    * `OpenAI__Models__0__CostPer1KWebSearches` - the model cost per 1K web searches (if the model does not support web searches, omit this setting)

### Updating configuration files

To make changes to users or user groups after deployment, you can edit the files in the `config` blob container. A user with reviewer access must then navigate to `/api/refresh` for the changes to take effect.

### Contributing

If you have a question or feature request, please open an issue.

To contribute improvements to this project, or to adapt the code for the specific needs of your organisation, you are welcome to fork the repository.

Pull requests are welcome; please open an issue first to discuss.