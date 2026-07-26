ARG DOTNET_VERSION=11.0-preview

FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}-resolute-chiseled-composite-extra AS base
USER $APP_UID
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS build
WORKDIR /src
COPY OrgAI.csproj .
RUN dotnet restore OrgAI.csproj
COPY . .
RUN dotnet publish OrgAI.csproj -c Release -o /app/publish --no-restore /p:UseAppHost=false

FROM base AS final
WORKDIR /app
ARG GITHUB_RUN_NUMBER
ENV GITHUB_RUN_NUMBER=$GITHUB_RUN_NUMBER
COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "OrgAI.dll"]
