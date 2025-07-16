ARG DOTNET_VERSION=10.0-preview

FROM mcr.microsoft.com/dotnet/aspnet:${DOTNET_VERSION}-noble-chiseled-composite-extra AS base
USER $APP_UID
WORKDIR /app
EXPOSE 8080
EXPOSE 8081

FROM mcr.microsoft.com/dotnet/sdk:${DOTNET_VERSION} AS build
WORKDIR /src
COPY OrgAI.csproj .
RUN dotnet restore OrgAI.csproj
COPY . .
RUN dotnet build OrgAI.csproj -c Release -o /app/build

FROM build AS publish
RUN dotnet publish OrgAI.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM base AS final
WORKDIR /app
ARG GITHUB_RUN_NUMBER
ENV GITHUB_RUN_NUMBER=$GITHUB_RUN_NUMBER
COPY --from=publish /app/publish .
ENTRYPOINT ["dotnet", "OrgAI.dll"]