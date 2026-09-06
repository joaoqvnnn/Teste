class WhatsappClient
  def initialize
    @base_url = ENV['BAILEYS_API_URL'] || 'http://localhost:3001'
  end

  def send_message(to, text, buttons: nil)
    payload = { to: to, text: text }
    payload[:buttons] = buttons if buttons.present?

    post('/send-message', payload)
  end

  private

  def post(endpoint, data)
    response = Faraday.post("#{@base_url}#{endpoint}") do |req|
      req.headers['Content-Type'] = 'application/json'
      req.body = data.to_json
    end

    JSON.parse(response.body) rescue { error: 'Erro na comunicação' }
  rescue => e
    Rails.logger.error "Erro ao chamar Baileys: #{e.message}"
    nil
  end
end
