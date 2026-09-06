Rails.application.routes.draw do
  post '/whatsapp/webhook', to: 'whatsapp#webhook'
  get '/health', to: proc { [200, {}, ['OK']] }
  root 'application#hello'
end
