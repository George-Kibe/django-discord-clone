from django.http import HttpResponse
from django.shortcuts import render, redirect
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth import authenticate, login, logout
from django.db.models import Q
from .models import Room, Topic, Message, User
from .forms import RoomForm, UserForm, MyUserCreationForm
# imports for pdf
import requests
from django.http import FileResponse
import io
import datetime
import os
import json
from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.platypus import Paragraph, Table, TableStyle, Frame, Spacer
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.lib.pagesizes import letter

# Create your views here.
# get_pdf


def get_pdf(request):
    # create Bytestream buffer
    buf = io.BytesIO()
    # create a canvas
    c = canvas.Canvas(buf, pagesize=letter, bottomup=0)
    # create a text object
    textobj = c.beginText()
    textobj.setTextOrigin(inch, inch)
    textobj.setFont("Helvetica", 14)
    # Add some lines of text
    rooms = Room.objects.all()
    lines = []
    # loop
    for room in rooms:
        lines.append(str(room.host))
        lines.append("============================")
    print(lines)
    for line in lines:
        textobj.textLine(line)
    # finish up
    c.drawText(textobj)
    c.showPage()
    c.save()
    buf.seek(0)
    # return something
    return FileResponse(buf, as_attachment=True, filename="rooms.pdf")


def login_page(request):
    page = 'login'
    if request.user.is_authenticated:
        messages.success(request, "User is already Logged in")
        return redirect('home')

    if request.method == "POST":
        email = request.POST.get('email').lower()
        password = request.POST.get('password')
        try:
            user = User.objects.get(email=email)
        except:
            messages.error(request, "User does not exist")
        user = authenticate(request, email=email, password=password)
        if user is not None:
            login(request, user)
            messages.success(
                request, f'Welcome {user.username}, You have successfully logged in')
            return redirect('home')
        else:
            messages.error(request, 'Invalid Username or Password')

    context = {'page': page}
    return render(request, 'base/login_register.html', context)


def logout_user(request):
    logout(request)
    return redirect('home')


def register_user(request):
    page = "register"
    form = MyUserCreationForm()
    context = {'page': page, 'form': form}
    if request.method == 'POST':
        form = MyUserCreationForm(request.POST)
        if form.is_valid:
            user = form.save(commit=False)
            user.username = user.username.lower()
            user.save()
            login(request, user)
            return redirect('home')
        else:
            messages.error(request, 'An error occured')
            return render(request, 'base/login_register.html', context)

    return render(request, 'base/login_register.html', context)


def home(request):
    q = request.GET.get('q')
    if request.GET.get('q') == None:
        q = ''
    rooms = Room.objects.filter(  # search functionality, have any of the below
        Q(topic__name__icontains=q) |
        Q(name__icontains=q) |
        Q(description__icontains=q) |
        Q(host__username__icontains=q)
    )
    topics = Topic.objects.all()[0:5]
    room_count = rooms.count()
    room_messages = Message.objects.all().filter(
        Q(room__topic__name__icontains=q)
    ).order_by('-created')

    context = {'rooms': rooms, 'topics': topics,
               'room_count': room_count, 'room_messages': room_messages}
    return render(request, 'base/home.html', context)


def room(request, pk):
    room = Room.objects.get(id=pk)
    room_messages = room.message_set.all().order_by(
        '-created')  # get all room_messages related to this room
    participants = room.participants.all()

    if request.method == "POST":
        message = Message.objects.create(
            user=request.user,
            room=room,
            body=request.POST.get('body')
        )
        room.participants.add(request.user)
        message.save()
        return redirect('room', pk=room.id)
    context = {'room': room, 'room_messages': room_messages,
               'participants': participants}
    return render(request, 'base/room.html', context)


def user_profile(request, pk):
    user = User.objects.get(id=pk)
    rooms = user.room_set.all()
    room_messages = user.message_set.all()
    topics = Topic.objects.all()
    context = {'user': user, 'rooms': rooms,
               'topics': topics, 'room_messages': room_messages}
    return render(request, 'base/profile.html', context)


@login_required(login_url='/login')
def create_room(request):
    form = RoomForm()
    topics = Topic.objects.all()
    if request.method == "POST":
        #form = RoomForm(request.POST)
        topic_name = request.POST.get('topic')
        topic, created = Topic.objects.get_or_create(name=topic_name)
        Room.objects.create(
            host=request.user,
            topic=topic,
            name=request.POST.get('name'),
            description=request.POST.get('description')
        )
        return redirect('home')

    context = {'form': form, 'topics': topics}
    return render(request, 'base/room_form.html', context)


@login_required(login_url='/login')
def update_room(request, pk):
    room = Room.objects.get(id=pk)
    form = RoomForm(instance=room)
    topics = Topic.objects.all()

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        topic_name = request.POST.get('topic')
        topic, created = Topic.objects.get_or_create(name=topic_name)
        room.name = request.POST.get('name')
        room.topic = topic
        room.description = request.POST.get('description')
        print(room.description)
        room.save()
        return redirect('home')

    context = {'form': form, 'topics': topics, 'room': room}
    return render(request, 'base/room_form.html', context)


@login_required(login_url='/login')
def delete_room(request, pk):
    room = Room.objects.get(id=pk)

    if request.user != room.host:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        room.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj': room})


@login_required(login_url='/login')
def delete_message(request, pk):
    message = Message.objects.get(id=pk)

    if request.user != message.user:
        return HttpResponse("You Do Not Have the Necessary Privileges!")

    if request.method == "POST":
        message.delete()
        return redirect('home')
    return render(request, 'base/delete.html', {'obj': message})


@login_required(login_url='/login')
def update_user(request):
    user = request.user
    form = UserForm(instance=user)

    if request.method == "POST":
        form = UserForm(request.POST, request.FILES, instance=user)
        if form.is_valid():
            form.save()
            return redirect('user_profile', pk=user.id)
    context = {'form': form}
    return render(request, 'base/update-user.html', context)


def topics_page(request):
    q = request.GET.get('q')
    if request.GET.get('q') == None:
        q = ''
    topics = Topic.objects.filter(name__icontains=q)
    context = {'topics': topics}
    return render(request, 'base/topics.html', context)


def activity_page(request):
    room_messages = Message.objects.all()
    context = {'room_messages': room_messages}
    return render(request, 'base/activity.html', context)


def get_pdf_json(request):
    url = "https://jsonplaceholder.typicode.com/users"
    response = requests.request("GET", url)
    data = response.text
    data = json.loads(data)
    pdf = canvas.Canvas("document.pdf")
    flow_obj1 = []
    flow_obj2 = []
    styles = getSampleStyleSheet()
    user = data[0]
    user1 = "Test User"
    text = 'This is The document generated by {}'.format(user1)
    t1 = Paragraph(text, style=styles["Normal"])
    flow_obj1.append(t1)
    flow_obj1.append(Spacer(6, 6))
    text1 = "Data generated at : " + str(datetime.datetime.now())
    t2 = Paragraph(text1, style=styles["Normal"])
    flow_obj1.append(t2)
    flow_obj1.append(Spacer(6, 6))
    frame = Frame(40, 600, 500, 100, showBoundary=1)
    frame.addFromList(flow_obj1, pdf)
    pdf.showPage()
    pdf.save()
    return FileResponse(pdf, as_attachment=True, filename="document.pdf")
